/**
 * Stage 4 (v-next) end-to-end walkthrough of "Can you 6-0?":
 * landing -> Easy two-stage draft (10 species -> set, Species Clause, ladder) ->
 * gauntlet (simulating state, retro battle stage at 1x, instant/skip) -> result
 * (flawless or eliminated) with post-mortem -> Draft again. Plus a Hard-mode
 * bundle spot-check. The opponent pool is the built-in teams merged with
 * mocked external sample teams (crob.at + pokepaste).
 *
 * Uses ?config=fast&seed=41 — FAST battles keep the run quick and Easy mode's
 * early rungs field random opponents, quicker still. config is real product
 * surface (the Tera-tuning session tool).
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

// A valid gen9ou export served as a mocked external "sample team". Its species
// set does not collide with the base fixture, so it survives dedup and grows
// the pool (proving the runtime fetch/import/validate/merge path).
const SAMPLE_EXPORT = `Great Tusk @ Heavy-Duty Boots
Ability: Protosynthesis
Tera Type: Water
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Headlong Rush
- Ice Spinner
- Rapid Spin
- Knock Off

Kingambit @ Leftovers
Ability: Supreme Overlord
Tera Type: Ghost
EVs: 112 HP / 252 Atk / 144 Spe
Adamant Nature
- Swords Dance
- Kowtow Cleave
- Sucker Punch
- Iron Head

Dragapult @ Choice Specs
Ability: Infiltrator
Tera Type: Ghost
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Shadow Ball
- Draco Meteor
- Flamethrower
- U-turn

Gholdengo @ Air Balloon
Ability: Good as Gold
Tera Type: Fighting
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Make It Rain
- Shadow Ball
- Nasty Plot
- Recover

Gliscor @ Toxic Orb
Ability: Poison Heal
Tera Type: Water
EVs: 244 HP / 248 SpD / 16 Spe
Careful Nature
- Earthquake
- Knock Off
- Protect
- Spikes

Slowking-Galar @ Heavy-Duty Boots
Ability: Regenerator
Tera Type: Water
EVs: 248 HP / 8 Def / 252 SpD
Sassy Nature
IVs: 0 Atk / 0 Spe
- Chilly Reception
- Future Sight
- Sludge Bomb
- Thunder Wave
`;

function fail(message) {
  console.error(`E2E FAIL: ${message}`);
  process.exit(1);
}
const ok = message => console.log(`ok: ${message}`);

// Silent-breakage gates. `pageerror` already fails fast on an uncaught throw;
// these accumulate the two classes a human is otherwise left to eyeball —
// console errors (React warnings, caught-and-logged failures) and same-origin
// request failures (a broken /assets or /teams asset). Cross-origin misses
// (the sprite CDN when offline) surface as "Failed to load resource" console
// errors and are intentionally ignored: they aren't a code fault, and in CI
// (real network) they resolve. Checked once at the end for a clean summary.
const violations = {console: [], network: []};
function guard(page) {
  const origin = `http://localhost:${PORT}`;
  page.on('pageerror', error => fail(`page error: ${error.message}`));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) return; // covered by the network gate (same-origin only)
    violations.console.push(text);
  });
  page.on('response', res => {
    if (res.url().startsWith(origin) && res.status() >= 400) violations.network.push(`${res.status()} ${res.url()}`);
  });
  page.on('requestfailed', req => {
    if (req.url().startsWith(origin)) violations.network.push(`FAILED ${req.failure()?.errorText ?? ''} ${req.url()}`.trim());
  });
}
function assertNoSilentBreakage() {
  if (violations.network.length) fail(`same-origin request failures:\n  ${violations.network.join('\n  ')}`);
  if (violations.console.length) fail(`console errors during walkthrough:\n  ${violations.console.join('\n  ')}`);
  ok('no console errors or same-origin request failures across the walkthrough');
}

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
  // External sample-teams source: crob.at index -> pokepaste JSON. Two refs to
  // the same export exercise dedup (one survives).
  await page.route(/crob\.at\/api\/samples\/gen9ou/, route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {name: 'E2E Sample Team', author: 'e2e', url: 'https://pokepast.es/e2e1'},
        {name: 'E2E Sample Dupe', author: 'e2e', url: 'https://pokepast.es/e2e2'},
      ]),
    });
  });
  await page.route(/pokepast\.es\/.*\/json/, route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({paste: SAMPLE_EXPORT, title: 'E2E Sample Team', author: 'e2e'}),
    });
  });
}

async function main() {
  mkdirSync(shotsDir, {recursive: true});
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {stdio: 'ignore'});
  await new Promise(resolve => setTimeout(resolve, 3000));

  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  await routeData(page);
  guard(page);

  try {
    // 1. Landing: 6-0 card is enabled and first.
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('.mode-card');
    const cards = await page.locator('.mode-card').allTextContents();
    if (!cards[0].includes('Can you 6-0?')) fail('6-0 card should be present and enabled');
    if (await page.locator('.mode-card.disabled').count()) fail('no card should be disabled anymore');
    ok('landing: both modes enabled');

    // 2. Draft screen. Default is Normal (two-stage, 10 species).
    await page.goto(`http://localhost:${PORT}/#/sixoh?config=fast&seed=41`);
    await page.waitForSelector('.offer-card', {timeout: 60_000});
    const normalCount = await page.locator('.offer-card').count();
    if (normalCount !== 10) fail(`normal mode should offer 10 species, got ${normalCount}`);
    ok('default Normal mode deals 10 species (two-stage)');

    // Switch to Easy (same two-stage draft; opponents ramp in difficulty).
    await page.locator('.mode-toggle button', {hasText: 'Easy'}).click();
    await page.waitForTimeout(300);
    const easyCount = await page.locator('.offer-card').count();
    if (easyCount !== 10) fail(`easy mode should offer 10 species, got ${easyCount}`);
    ok('Easy mode selected — 10 species offers');

    // Ladder preview visible pre-gauntlet.
    const rungs = await page.locator('.ladder-preview .ladder-rung').count();
    if (rungs !== 6) fail(`ladder preview should show 6 rungs, got ${rungs}`);
    ok('gauntlet ladder revealed during draft');

    // Draft 6 via the two-stage flow (species -> set); Species Clause check.
    const picked = [];
    for (let i = 0; i < 6; i++) {
      const name = await page.locator('.offer-card .offer-name').first().textContent();
      if (picked.includes(name)) fail(`species offered again after drafting: ${name}`);
      picked.push(name);
      if (i === 2) await page.screenshot({path: `${shotsDir}/e2e-sixoh-draft.png`, fullPage: true});
      await page.locator('.offer-card').first().click(); // pick species
      await page.waitForSelector('.set-card', {timeout: 10_000});
      await page.locator('.set-card').first().click(); // pick its set
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

    // 4. First battle replays at 1x on the retro stage: HP windows + growing log.
    await page.waitForSelector('.battle-stage', {timeout: 120_000});
    await page.waitForSelector('.hp-bar', {timeout: 30_000});
    if ((await page.locator('.stage-field .hp-block').count()) < 1) fail('retro HP windows should render on the field');
    const logLen1 = (await page.locator('.battle-log').textContent()).length;
    await page.waitForTimeout(4000);
    const logText = await page.locator('.battle-log').textContent();
    if (logText.length <= logLen1) fail('battle log should grow during 1x replay');
    // No raw protocol leaks (· -end|..., -ability|...) and no broken possessive.
    if (/·|\|p[12]a:/.test(logText)) fail(`battle log leaks raw protocol: ${logText.slice(0, 120)}`);
    if (/You's|Them's|undefined/.test(logText)) fail(`battle log has a grammar/interp bug: ${logText.slice(0, 120)}`);
    await page.screenshot({path: `${shotsDir}/e2e-sixoh-battle.png`});
    ok('retro battle stage replays with HP windows and a clean, paced log');

    // 5. Instant through the rest of the run.
    await page.locator('.playback-controls button', {hasText: 'Instant'}).click();
    await page.waitForFunction(
      () => location.hash.includes('/sixoh/result') || document.querySelector('.simulating, .battle-stage'),
      undefined,
      {timeout: 60_000}
    );
    // Keep clicking Instant as new battles arrive until the result route.
    // Budget generously — a stall matchup can compute to maxTurns before it
    // replays. Fail fast if the run hits an actual error panel.
    for (let guard = 0; guard < 120; guard++) {
      if (page.url().includes('/sixoh/result')) break;
      if (await page.locator('.problems', {hasText: 'failed'}).count()) {
        fail(`gauntlet run errored: ${(await page.locator('.problems').first().textContent()).trim()}`);
      }
      const instant = page.locator('.playback-controls button', {hasText: 'Instant'});
      if (await instant.count()) {
        await instant.first().click().catch(() => {});
      }
      await page.waitForTimeout(2000);
    }
    if (!page.url().includes('/sixoh/result')) fail('run never reached the result screen (timed out)');
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

    // 7. Back from the result must NOT loop straight back to it (bug fix).
    await page.goBack();
    await page.waitForTimeout(600);
    if (page.url().includes('/sixoh/result')) fail('Back trapped on the result screen (redirect loop)');
    if (!(await page.locator('.empty-state', {hasText: 'This run is over'}).count())) {
      fail('expected the "run is over" terminal panel after Back, not a loop');
    }
    ok('Back from the result lands on the terminal panel (no redirect loop)');
    await page.locator('.empty-state button', {hasText: 'See the result'}).click();
    await page.waitForSelector('.result-card', {timeout: 10_000});

    // 8. "Step up" actually changes difficulty (this run was Easy → Normal).
    await page.locator('.result-actions button', {hasText: 'Step up to Normal'}).click();
    await page.waitForSelector('.offer-card', {timeout: 60_000});
    if (!(await page.locator('.mode-toggle button.active', {hasText: 'Normal'}).count())) {
      fail('Step up to Normal should start the draft in Normal mode');
    }
    ok('Step up threads the mode into the draft (Easy → Normal)');

    // 9. ?mode=hard deals 6 bundles with Hard pre-selected (mode from the hash).
    const page2 = await browser.newPage({viewport: {width: 1440, height: 1000}});
    await routeData(page2);
    guard(page2);
    await page2.goto(`http://localhost:${PORT}/#/sixoh?mode=hard&config=fast&seed=7`);
    await page2.waitForSelector('.offer-card', {timeout: 60_000});
    if (!(await page2.locator('.mode-toggle button.active', {hasText: 'Hard'}).count())) {
      fail('?mode=hard should pre-select Hard mode');
    }
    const bundleCount = await page2.locator('.offer-card').count();
    if (bundleCount !== 6) fail(`?mode=hard should deal 6 bundles, got ${bundleCount}`);
    const firstBundle = await page2.locator('.offer-card').first().textContent();
    if (!/·/.test(firstBundle)) fail('bundle should show item/nature meta');
    await page2.locator('.offer-card').first().click();
    await page2.waitForTimeout(200);
    if ((await page2.locator('.tray-slot.filled').count()) !== 1) fail('bundle pick should fill tray slot 1');
    ok('hard bundle flow works from the hash (6 bundles -> one-click pick fills tray)');
    await page2.close();

    assertNoSilentBreakage();
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
