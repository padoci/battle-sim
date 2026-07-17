/**
 * Stage 4 end-to-end walkthrough of "Can you 6-0?":
 * landing -> normal draft (6 bundles, Species Clause, ladder preview) ->
 * gauntlet (simulating state, battle stage at 1x, instant/skip) -> result
 * (flawless or eliminated) with post-mortem -> Draft again. Plus a beginner
 * two-stage draft spot-check.
 *
 * Uses ?config=fast&seed=41 — FAST battles keep the run ~6x quicker and the
 * config knob is real product surface (the Tera-tuning session tool).
 *
 * Usage:
 *   npm run build
 *   NODE_PATH=/opt/node22/lib/node_modules CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     node scripts/e2e-six-oh.mjs [--shots-dir DIR]
 */
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const PORT = 4322;
const shotsDir = process.argv.includes('--shots-dir')
  ? process.argv[process.argv.indexOf('--shots-dir') + 1]
  : 'logs';

function fail(message) {
  console.error(`E2E FAIL: ${message}`);
  process.exit(1);
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
    // 1. Landing: 6-0 card is enabled and first.
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('.mode-card');
    const cards = await page.locator('.mode-card').allTextContents();
    if (!cards[0].includes('Can you 6-0?')) fail('6-0 card should be present and enabled');
    if (await page.locator('.mode-card.disabled').count()) fail('no card should be disabled anymore');
    ok('landing: both modes enabled');

    // 2. Normal draft with dev params.
    await page.goto(`http://localhost:${PORT}/#/sixoh?config=fast&seed=41`);
    await page.waitForSelector('.offer-card', {timeout: 60_000});
    const bundleCount = await page.locator('.offer-card').count();
    if (bundleCount !== 6) fail(`normal mode should offer 6 bundles, got ${bundleCount}`);
    const firstBundle = await page.locator('.offer-card').first().textContent();
    if (!/·/.test(firstBundle)) fail('bundle should show item/nature meta');
    ok('normal draft deals 6 complete bundles');

    // Ladder preview visible pre-gauntlet.
    const rungs = await page.locator('.ladder-preview .ladder-rung').count();
    if (rungs !== 6) fail(`ladder preview should show 6 rungs, got ${rungs}`);
    ok('gauntlet ladder revealed during draft');

    // Pick 6; Species Clause: collect names as we go.
    const picked = [];
    for (let i = 0; i < 6; i++) {
      const name = await page.locator('.offer-card .offer-name').first().textContent();
      if (picked.includes(name)) fail(`species offered again after drafting: ${name}`);
      picked.push(name);
      if (i === 2) await page.screenshot({path: `${shotsDir}/e2e-sixoh-draft.png`, fullPage: true});
      await page.locator('.offer-card').first().click();
      await page.waitForTimeout(150);
    }
    const filled = await page.locator('.tray-slot.filled').count();
    if (filled !== 6) fail(`tray should be full, got ${filled}`);
    ok(`drafted 6 distinct mons: ${picked.join(', ')}`);

    // 3. Start the gauntlet.
    await page.locator('button.primary', {hasText: 'Start the gauntlet'}).click();
    await page.waitForSelector('.arena', {timeout: 15_000});
    await page.waitForSelector('.simulating, .battle-stage', {timeout: 15_000});
    ok('gauntlet started (simulating or stage visible)');

    // 4. First battle replays at 1x: HP bars + growing log.
    await page.waitForSelector('.battle-stage', {timeout: 120_000});
    await page.waitForSelector('.hp-bar', {timeout: 30_000});
    const logLen1 = (await page.locator('.battle-log').textContent()).length;
    await page.waitForTimeout(4000);
    const logLen2 = (await page.locator('.battle-log').textContent()).length;
    if (logLen2 <= logLen1) fail('battle log should grow during 1x replay');
    await page.screenshot({path: `${shotsDir}/e2e-sixoh-battle.png`});
    ok('battle stage replays with animated HP bars and a paced log');

    // 5. Instant through the rest of the run.
    await page.locator('.playback-controls button', {hasText: 'Instant'}).click();
    await page.waitForFunction(
      () => location.hash.includes('/sixoh/result') || document.querySelector('.simulating, .battle-stage'),
      undefined,
      {timeout: 60_000}
    );
    // Keep clicking Instant as new battles arrive until the result route.
    for (let guard = 0; guard < 40; guard++) {
      if (page.url().includes('/sixoh/result')) break;
      const instant = page.locator('.playback-controls button', {hasText: 'Instant'});
      if (await instant.count()) {
        await instant.first().click().catch(() => {});
      }
      await page.waitForTimeout(2000);
    }
    if (!page.url().includes('/sixoh/result')) fail('run never reached the result screen');
    ok('gauntlet ran to completion via instant playback');

    // 6. Result + post-mortem.
    await page.waitForSelector('.result-card', {timeout: 30_000});
    const record = await page.locator('.result-record').textContent();
    if (!/^\d–\d$/.test(record.trim())) fail(`record should render like 4–2, got: ${record}`);
    const headline = await page.locator('.result-card h1').textContent();
    if (!/(Flawless|Eliminated|Stalled)/.test(headline)) fail(`unexpected headline: ${headline}`);
    const reads = await page.locator('.pm-read').count();
    if (reads < 1) fail('post-mortem should have at least one read');
    const toggle = page.locator('.pm-toggle').first();
    if (await toggle.count()) {
      await toggle.click();
      const evidence = await page.locator('.pm-evidence li').count();
      if (evidence < 1) fail('expandable evidence should have mono lines');
    }
    await page.screenshot({path: `${shotsDir}/e2e-sixoh-result.png`, fullPage: true});
    ok(`result: "${headline.trim()}" (${record.trim()}) with ${reads} post-mortem read(s)`);

    // 7. Draft again restarts.
    await page.locator('.result-actions button', {hasText: 'Draft again'}).click();
    await page.waitForSelector('.offer-card', {timeout: 60_000});
    ok('Draft again restarts to a fresh hand');

    // 8. Beginner two-stage spot-check.
    const page2 = await browser.newPage({viewport: {width: 1440, height: 1000}});
    await routeData(page2);
    await page2.goto(`http://localhost:${PORT}/#/sixoh?config=fast&seed=7`);
    await page2.waitForSelector('.offer-card', {timeout: 60_000});
    await page2.locator('.mode-toggle button', {hasText: 'Beginner'}).click();
    await page2.waitForTimeout(300);
    const speciesCount = await page2.locator('.offer-card').count();
    if (speciesCount !== 10) fail(`beginner should offer 10 species, got ${speciesCount}`);
    await page2.locator('.offer-card').first().click();
    await page2.waitForSelector('.set-card', {timeout: 10_000});
    const setCards = await page2.locator('.set-card').count();
    if (setCards < 1) fail('species pick should reveal its named sets');
    await page2.locator('.set-card').first().click();
    await page2.waitForTimeout(200);
    if ((await page2.locator('.tray-slot.filled').count()) !== 1) fail('set pick should fill tray slot 1');
    ok(`beginner two-stage flow works (10 species -> ${setCards} sets -> tray)`);
    await page2.close();

    console.log('\nE2E PASS — Can you 6-0? walkthrough green');
  } finally {
    await browser.close();
    preview.kill();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
