/**
 * Live-timing endurance e2e for the gauntlet battle stage — the thing that
 * caught the mid-battle reset bug. Regular e2e (e2e-six-oh.mjs) clicks
 * "Skip to result" almost immediately, which fast-forwards straight past the
 * one condition that actually triggers a reset: a rung still replaying in
 * real time when its background prefetch (ensureComputed) resolves and the
 * parent screen re-renders. This script instead lets a real gauntlet play at
 * normal speed across at least one rung transition and continuously asserts
 * the invariant a reset breaks: while displaying the SAME battle, the turn
 * counter and log line count must never go backwards.
 *
 * Reads title/turn/log-line-count via a single page.evaluate() per poll
 * (atomic in-page read) rather than separate locator round-trips — three
 * separate awaits per poll can race a real state transition and manufacture
 * a spurious "mismatch" that's just a read-timing artifact, not a genuine
 * simultaneous change in the same React commit.
 *
 * Usage:
 *   npm run build
 *   NODE_PATH=... CHROMIUM_PATH=... node scripts/e2e-live-playback.mjs [--shots-dir DIR]
 */
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const PORT = 4327;
const shotsDir = process.argv.includes('--shots-dir')
  ? process.argv[process.argv.indexOf('--shots-dir') + 1]
  : 'logs';

function fail(message) {
  console.error(`E2E FAIL: ${message}`);
  process.exitCode = 1;
}
const ok = message => console.log(`ok: ${message}`);

async function routeData(page) {
  await page.route(/https:\/\/(data\.pkmn\.cc|raw\.githubusercontent\.com).*\/(sets|stats|teams)\/gen9ou\.json/, route => {
    const kind = route.request().url().match(/(sets|stats|teams)\/gen9ou\.json/)[1];
    const file =
      kind === 'teams'
        ? 'test/fixtures/gen9ou.teams.full.json'
        : kind === 'sets'
          ? 'test/fixtures/gen9ou.sets.full.json'
          : 'test/fixtures/stats.fixture.json';
    route.fulfill({status: 200, contentType: 'application/json', body: readFileSync(file, 'utf8')});
  });
}

async function main() {
  mkdirSync(shotsDir, {recursive: true});
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {stdio: 'ignore'});
  await new Promise(resolve => setTimeout(resolve, 3000));

  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  await routeData(page);
  page.on('pageerror', error => fail(`page error: ${error.message}`));

  try {
    await page.goto(`http://localhost:${PORT}/#/sixoh?config=fast&seed=41&speed=2`);
    await page.waitForSelector('.offer-card', {timeout: 60_000});
    for (let i = 0; i < 6; i++) {
      await page.locator('.offer-card').first().click();
      await page.waitForTimeout(100);
    }
    await page.locator('button.primary', {hasText: 'Start the gauntlet'}).click();
    await page.waitForSelector('.battle-stage', {timeout: 120_000});
    ok('gauntlet started, first battle stage visible');

    // Pin 2x via the dev param (the default is 1x now) rather than the max —
    // this needs REAL elapsed wall-clock time for a rung's background
    // prefetch to land while the current rung is still replaying, which a
    // near-instant "10x" playback would race away from reliably.

    let prevTurn = -1;
    let prevLogLines = -1;
    let prevTitle = '';
    let sawAnyProgress = false;
    let transitions = 0;
    let anomalies = 0;
    const deadline = Date.now() + 90_000;
    const REQUIRED_TRANSITIONS = 1;

    while (Date.now() < deadline && transitions < REQUIRED_TRANSITIONS + 1) {
      const snap = await page.evaluate(() => {
        const stage = document.querySelector('.battle-stage');
        if (!stage) return null;
        const title = document.querySelector('.battle-title')?.textContent ?? null;
        const turnText = document.querySelector('.turn-label')?.textContent ?? '';
        const turn = Number(turnText.replace(/\D/g, ''));
        const logLines = document.querySelectorAll('.battle-log > div').length;
        return {title, turn, logLines};
      });
      if (!snap) {
        if (page.url().includes('/sixoh/result')) break;
        await page.waitForTimeout(250);
        continue;
      }
      const {title, turn, logLines} = snap;

      if (title === prevTitle && prevTurn >= 0) {
        if (turn < prevTurn || logLines < prevLogLines) {
          anomalies++;
          fail(
            `RESET DETECTED: turn ${prevTurn} -> ${turn}, log lines ${prevLogLines} -> ${logLines}, ` +
              `while still on "${title}"`
          );
          await page.screenshot({path: `${shotsDir}/e2e-live-playback-reset-${anomalies}.png`}).catch(() => {});
        }
        if (turn > prevTurn) sawAnyProgress = true;
      } else if (prevTitle && title !== prevTitle) {
        transitions++;
        ok(`legitimate rung transition: "${prevTitle}" -> "${title}"`);
      }

      prevTurn = turn;
      prevLogLines = logLines;
      prevTitle = title;
      await page.waitForTimeout(250);
    }

    if (!sawAnyProgress) fail('never observed the turn counter advance at all — test setup problem, not a genuine pass');
    if (transitions < REQUIRED_TRANSITIONS) {
      fail(`only observed ${transitions} rung transition(s) within the time budget — need at least ${REQUIRED_TRANSITIONS} to exercise the prefetch-overlap window`);
    }
    if (anomalies === 0 && sawAnyProgress && transitions >= REQUIRED_TRANSITIONS) {
      ok(`no backward turn/log jump within any single rung, across ${transitions} rung transition(s), at real playback speed`);
    }

    if (process.exitCode) {
      console.error('\nE2E FAIL — live playback found a mid-battle reset');
      process.exit(process.exitCode);
    }
    console.log('\nE2E PASS — live playback walkthrough green (no mid-battle reset under real prefetch timing)');
  } finally {
    await browser.close();
    preview.kill();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
