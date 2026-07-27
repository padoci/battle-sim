/**
 * Stage 2 measurement gate — browser side (the REAL gate numbers).
 *
 * Usage:
 *   BUILD_TOOLS=1 npm run build
 *   NODE_PATH=/opt/node22/lib/node_modules node scripts/measure-browser.mjs
 *
 * BUILD_TOOLS is required: a plain `npm run build` deliberately omits
 * measure.html so it never ships to production, and `vite preview` serves
 * only what the build emitted. Without it every run 404s.
 *
 * Spawns `vite preview`, drives measure.html in headless Chromium for the
 * FAST and STRONG configs, writes logs/browser-results.json, then re-renders
 * logs/gate-report.md via `vite-node scripts/measure.ts --render-only`.
 */
import {spawn, execSync} from 'node:child_process';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const PORT = 4319;
const RUNS = [
  {config: 'fast', battles: 15, timeoutMs: 10 * 60_000},
  {config: 'strong', battles: 5, timeoutMs: 20 * 60_000},
];

async function main() {
  // Fail with the fix rather than a wall of 404s: a plain `npm run build`
  // omits measure.html on purpose so it can't ship to production.
  if (!existsSync('dist/measure.html')) {
    console.error(
      'dist/measure.html is missing.\n' +
        'The production build omits the dev tools by design. Rebuild with:\n' +
        '  BUILD_TOOLS=1 npm run build'
    );
    process.exit(1);
  }
  mkdirSync('logs', {recursive: true});
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    detached: false,
  });
  await new Promise(resolve => setTimeout(resolve, 3000));

  const results = {};
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});
  try {
    for (const run of RUNS) {
      const page = await browser.newPage();
      page.on('console', m => {
        if (m.type() === 'error') console.error('[page]', m.text());
      });
      const url = `http://localhost:${PORT}/measure.html?battles=${run.battles}&config=${run.config}&seed=1`;
      console.log(`running ${run.config} (${run.battles} battles): ${url}`);
      await page.goto(url);
      const report = await page.waitForFunction(
        () => window.__gateReport ?? (window.__gateError ? {error: window.__gateError} : undefined),
        undefined,
        {timeout: run.timeoutMs, polling: 2000}
      );
      const value = await report.jsonValue();
      if (value.error) throw new Error(`browser run failed: ${value.error}`);
      results[run.config] = value;
      console.log(`${run.config}: ${value.msPerDecision.mean.toFixed(1)} ms/decision mean`);
      await page.close();
    }
  } finally {
    await browser.close();
    preview.kill();
  }

  writeFileSync('logs/browser-results.json', JSON.stringify(results, null, 2));
  console.log('wrote logs/browser-results.json');
  execSync('npx vite-node scripts/measure.ts --render-only', {stdio: 'inherit'});
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
