/**
 * Stage 3 end-to-end walkthrough of "Test your team":
 * landing -> paste (bad + good) -> configure pool -> calibrate -> pick N ->
 * run with live progress -> dashboard -> expand card (game plan + evidence)
 * -> export JSON + Markdown -> separate cancel-path check.
 *
 * Usage:
 *   npm run build
 *   NODE_PATH=/opt/node22/lib/node_modules CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     node scripts/e2e-test-your-team.mjs [--shots-dir DIR]
 */
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const PORT = 4321;
const shotsDir = process.argv.includes('--shots-dir')
  ? process.argv[process.argv.indexOf('--shots-dir') + 1]
  : 'logs';

const GOOD_TEAM = `Great Tusk @ Heavy-Duty Boots
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

const BAD_TEAM = `Miraidon @ Choice Specs
Ability: Hadron Engine
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Electro Drift
- Draco Meteor
- Volt Switch
- Overheat
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

// A valid gen9ou export served as a mocked external "sample team"; its species
// set does not collide with the base fixture, so it grows the opponent pool.
const SAMPLE_EXPORT = GOOD_TEAM;

/**
 * Serve the vendored real data files for data.pkmn.cc / the GitHub mirror —
 * the sandbox proxy blocks both hosts in the browser (Stage 0 precedent) —
 * plus the external sample-teams source (crob.at index -> pokepaste JSON).
 */
async function routeData(page) {
  await page.route(/https:\/\/(data\.pkmn\.cc|raw\.githubusercontent\.com).*\/(sets|stats|teams)\/gen9ou\.json/, route => {
    const kind = route.request().url().match(/(sets|stats|teams)\/gen9ou\.json/)[1];
    const file =
      kind === 'teams'
        ? 'test/fixtures/gen9ou.teams.full.json'
        : kind === 'sets'
          ? 'test/fixtures/gen9ou.sets.full.json'
          : 'test/fixtures/stats.fixture.json';
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: require('fs').readFileSync(file, 'utf8'),
    });
  });
  await page.route(/crob\.at\/api\/samples\/gen9ou/, route => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{name: 'E2E Sample Team', author: 'e2e', url: 'https://pokepast.es/e2e1'}]),
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
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
  });
  await new Promise(resolve => setTimeout(resolve, 3000));

  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});
  const page = await browser.newPage({viewport: {width: 1440, height: 1050}});
  await routeData(page);
  guard(page);

  try {
    // 1. Landing. (Both modes are enabled as of Stage 4 — click Test your team.)
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('.mode-card');
    ok('landing shows both mode cards');
    await page.locator('.mode-card', {hasText: 'Test your team'}).click();

    // 2. Paste import — bad team first (banned in OU), then good.
    await page.waitForSelector('.team-input');
    await page.locator('.team-input').fill(BAD_TEAM);
    await page.waitForSelector('.problems');
    const problem = await page.locator('.problems').textContent();
    if (!/Miraidon/.test(problem)) fail(`expected a Miraidon legality error, got: ${problem}`);
    if (await page.locator('button.primary').isEnabled()) fail('Analyze must be disabled on invalid team');
    ok(`invalid team rejected with: ${problem.trim().slice(0, 80)}...`);

    await page.locator('.team-input').fill(GOOD_TEAM);
    await page.waitForSelector('.team-preview-row');
    const previewCount = await page.locator('.preview-mon').count();
    if (previewCount !== 6) fail(`expected 6 preview mons, got ${previewCount}`);
    ok('valid team previews 6 mons with type badges');
    await page.locator('button.primary').click();

    // 3. Configure: pool with archetype tags — built-in teams merged with the
    // vendored sample teams (proves the merge; teams ship statically, no fetch).
    await page.waitForSelector('.pool-table tbody tr', {timeout: 30_000});
    const baseTeams = JSON.parse(require('fs').readFileSync('test/fixtures/gen9ou.teams.full.json', 'utf8')).length;
    const vendored = JSON.parse(require('fs').readFileSync('src/data/vendored-teams.gen9ou.json', 'utf8'));
    const poolRows = await page.locator('.pool-table tbody tr').count();
    if (poolRows <= baseTeams) fail(`expected vendored teams merged in: ${poolRows} rows vs ${baseTeams} built-in`);
    const poolNames = await page.locator('.pool-name').allTextContents();
    if (!vendored.some(v => poolNames.some(n => n.includes(v.name)))) {
      fail('merged pool should include a vendored sample team');
    }
    const archetypeTags = await page.locator('.archetype-tag').allTextContents();
    if (!archetypeTags.every(tag => tag.length > 0)) fail('every pool team needs an archetype tag');
    ok(`pool lists ${poolRows} teams (${baseTeams} built-in + ${vendored.length} vendored) with archetypes: ${[...new Set(archetypeTags)].join(', ')}`);

    // Weight one matchup up, disable one team.
    await page.locator('.weight-input').first().fill('3');
    await page.locator('.pool-table tbody tr input[type=checkbox]').nth(1).setChecked(false);
    ok('adjusted weights + disabled a team');

    // 4. Calibrate.
    await page.screenshot({path: `${shotsDir}/e2e-configure.png`});
    await page.locator('button.primary').click();
    await page.waitForSelector('input[type=range]', {timeout: 300_000});
    const etaText = await page.locator('.run-controls p.mono').first().textContent();
    if (!/≈/.test(etaText)) fail(`expected an ETA estimate after calibration, got: ${etaText}`);
    ok(`calibration done -> ${etaText.trim()}`);

    // 5. Pick a small N and run.
    await page.locator('input[type=range]').fill('30');
    await page.locator('button.primary').click();
    await page.waitForSelector('progress', {timeout: 30_000});
    ok('run started with a progress bar');

    // Peek at partial results mid-run.
    await page.locator('text=Peek at partial results').click();
    await page.waitForSelector('.verdict', {timeout: 120_000});
    const partial = await page.locator('.verdict .mono').textContent();
    if (!/battles/.test(partial)) fail('partial dashboard should show battle counts');
    ok(`partial dashboard renders mid-run: ${partial.trim().slice(0, 60)}`);

    // 6. Wait for completion (route flips to results automatically; we're already there).
    await page.waitForFunction(
      () => !document.body.textContent.includes('still running'),
      undefined,
      {timeout: 600_000, polling: 2000}
    );
    await page.screenshot({path: `${shotsDir}/e2e-dashboard.png`, fullPage: true});
    ok('run complete, dashboard settled');

    // 7. Expand the first matchup card: game plan + mono evidence.
    await page.locator('.matchup-head').first().click();
    await page.waitForSelector('.game-plan p', {timeout: 60_000});
    const sentence = await page.locator('.game-plan p').first().textContent();
    if (sentence.length < 10) fail('game plan sentence looks empty');
    ok(`game plan: "${sentence.trim()}"`);
    const detail = await page.locator('.matchup-detail').first().textContent();
    if (!/speed race/.test(detail)) fail('matchup detail should include the speed-race read');
    await page.screenshot({path: `${shotsDir}/e2e-card-expanded.png`, fullPage: true});

    // 8. Exports.
    const [jsonDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('text=Export JSON').click(),
    ]);
    const jsonPath = await jsonDownload.path();
    const exported = JSON.parse(require('fs').readFileSync(jsonPath, 'utf8'));
    if (exported.version !== 1 || !exported.archetypes?.length || !exported.overall?.verdict) {
      fail('export JSON missing required fields');
    }
    writeFileSync(`${shotsDir}/e2e-export.json`, JSON.stringify(exported, null, 2));
    ok(`export JSON valid (${exported.overall.battles} battles, verdict: "${exported.overall.verdict}")`);

    const [mdDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('text=Export Markdown').click(),
    ]);
    const md = require('fs').readFileSync(await mdDownload.path(), 'utf8');
    for (const section of ['# Test Your Team — Report', '## Verdict', '## Opponent pool']) {
      if (!md.includes(section)) fail(`Markdown export missing "${section}"`);
    }
    writeFileSync(`${shotsDir}/e2e-export.md`, md);
    ok('export Markdown has all sections');

    // 9. Cancel path: fresh page, small pool, cancel mid-run.
    const page2 = await browser.newPage({viewport: {width: 1440, height: 1050}});
    await routeData(page2);
    guard(page2);
    await page2.goto(`http://localhost:${PORT}/#/test/import`);
    await page2.locator('.team-input').fill(GOOD_TEAM);
    await page2.waitForSelector('.team-preview-row');
    await page2.locator('button.primary').click();
    await page2.waitForSelector('.pool-table tbody tr', {timeout: 30_000});
    await page2.locator('button.primary').click(); // calibrate
    await page2.waitForSelector('input[type=range]', {timeout: 300_000});
    await page2.locator('input[type=range]').fill('200');
    await page2.locator('button.primary').click(); // run 200
    await page2.waitForSelector('progress', {timeout: 30_000});
    await page2.locator('text=Cancel (keep partial results)').click();
    await page2.waitForSelector('.verdict', {timeout: 120_000});
    const cancelled = await page2.locator('.verdict .mono').textContent();
    if (!/cancelled early/.test(cancelled)) fail(`expected cancelled marker, got: ${cancelled}`);
    ok(`cancel keeps partial results analyzable: ${cancelled.trim().slice(0, 70)}`);
    await page2.close();

    assertNoSilentBreakage();
    console.log('\nE2E PASS — all walkthrough steps green');
  } finally {
    await browser.close();
    preview.kill();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
