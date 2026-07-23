/**
 * Fault-injection e2e for "Test your team"'s ConfigureRun pool load — the
 * sibling of the "Dealing your first hand..." stuck/slow-load bug found on
 * the "Can you 6-0?" draft screen. ConfigureRun's pool-load effect had no
 * watchdog and no loading UI at all: a slow-but-healthy data host left the
 * pool table silently empty forever with nothing telling the user anything
 * was happening. This deliberately injects a slow/down data host (rather
 * than mocking it away, as e2e-test-your-team.mjs does for speed) and
 * asserts the same graceful degradation SixOhDraft already had: progressive
 * status text, bounded recovery via the mirror, and a real error panel (not
 * a silently-empty table) when nothing works.
 *
 * Usage:
 *   npm run build
 *   NODE_PATH=... CHROMIUM_PATH=... node scripts/e2e-configure-load-resilience.mjs [--shots-dir DIR]
 */
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const PORT = 4328;
const shotsDir = process.argv.includes('--shots-dir')
  ? process.argv[process.argv.indexOf('--shots-dir') + 1]
  : 'logs';

function fail(message) {
  console.error(`E2E FAIL: ${message}`);
  process.exitCode = 1;
}
const ok = message => console.log(`ok: ${message}`);

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

function fixtureFor(kind) {
  const file =
    kind === 'teams'
      ? 'test/fixtures/gen9ou.teams.full.json'
      : kind === 'sets'
        ? 'test/fixtures/gen9ou.sets.full.json'
        : 'test/fixtures/stats.fixture.json';
  return readFileSync(file, 'utf8');
}

async function routeData(page, {primary, mirror}) {
  await page.route(/https:\/\/data\.pkmn\.cc.*\/(sets|stats|teams)\/gen9ou\.json/, async route => {
    const kind = route.request().url().match(/(sets|stats|teams)\/gen9ou\.json/)[1];
    if (primary.delayMs) await new Promise(r => setTimeout(r, primary.delayMs));
    if (primary.down) return route.fulfill({status: 503, body: 'primary down (injected)'});
    route.fulfill({status: 200, contentType: 'application/json', body: fixtureFor(kind)});
  });
  await page.route(/https:\/\/raw\.githubusercontent\.com.*\/(sets|stats|teams)\/gen9ou\.json/, async route => {
    const kind = route.request().url().match(/(sets|stats|teams)\/gen9ou\.json/)[1];
    if (mirror.delayMs) await new Promise(r => setTimeout(r, mirror.delayMs));
    if (mirror.down) return route.fulfill({status: 503, body: 'mirror down (injected)'});
    route.fulfill({status: 200, contentType: 'application/json', body: fixtureFor(kind)});
  });
  // "Test your team"'s pool also merges crob.at/pokepaste sample teams; keep
  // that path healthy and fast in every scenario here since the data-host
  // fault path is what we're testing, not this one (already covered by the
  // regular e2e suite).
  await page.route(/crob\.at\/api\/samples\/gen9ou/, route => {
    route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify([])});
  });
}

async function withServer(fn) {
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {stdio: 'ignore'});
  await new Promise(resolve => setTimeout(resolve, 3000));
  try {
    await fn();
  } finally {
    preview.kill();
  }
}

/** Get a fresh page onto ConfigureRun with a team already pasted, so the
 *  pool-load effect fires the moment we land. */
async function gotoConfigureWithTeam(page) {
  await page.goto(`http://localhost:${PORT}/#/test/import`);
  await page.waitForSelector('.team-input');
  await page.locator('.team-input').fill(GOOD_TEAM);
  await page.waitForSelector('.team-preview-row');
  await page.locator('button.primary').click();
}

/** Scenario 1: primary stalls, mirror is healthy. Sequential failover with a
 *  STALL timeout (src/data/fetch.ts): the primary gets ~8s of silence before
 *  it's aborted, then the mirror answers immediately. NOT racing the two
 *  concurrently on purpose — that was tried and reverted, because it splits
 *  bandwidth on a connection that's genuinely just slow (not dead), which
 *  made the real production bug worse (see the REGRESSION test in
 *  test/cache.test.ts). */
async function scenarioSlowPrimaryRecoversViaMirror(browser) {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  await routeData(page, {primary: {delayMs: 9000, down: true}, mirror: {}});
  page.on('pageerror', error => fail(`[configure-slow-primary] page error: ${error.message}`));

  const t0 = Date.now();
  await gotoConfigureWithTeam(page);
  let reachedPool = false;
  try {
    await page.waitForSelector('.pool-summary', {timeout: 15_000});
    reachedPool = true;
  } catch {
    fail('[configure-slow-primary] pool summary never appeared even though the mirror was healthy');
  }
  const elapsed = Date.now() - t0;
  if (reachedPool) {
    ok(`[configure-slow-primary] stalled primary failed over to the mirror (pool in ${elapsed}ms)`);
    // ~8s stall window + near-instant mirror; generous CI headroom.
    if (elapsed > 12_000) {
      fail(`[configure-slow-primary] recovery took ${elapsed}ms — expected roughly the 8s stall window, not much more`);
    }
  }
  await page.screenshot({path: `${shotsDir}/e2e-configure-load-slow-primary.png`}).catch(() => {});
  await page.close();
}

/** Scenario 1b: BOTH hosts crawling — the case where the progressive status
 *  text still matters, and the slower-but-alive mirror must still land. */
async function scenarioBothSlowShowsProgress(browser) {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  // Primary produces nothing until its ~8s stall timeout aborts it; mirror
  // is then tried and takes 7s to answer — under ITS OWN stall window, so it
  // succeeds at roughly 8s + 7s = 15s total.
  await routeData(page, {primary: {delayMs: 20_000, down: true}, mirror: {delayMs: 7000}});
  page.on('pageerror', error => fail(`[configure-both-slow] page error: ${error.message}`));

  const t0 = Date.now();
  await gotoConfigureWithTeam(page);
  await page.waitForSelector('.empty-state', {timeout: 5000});

  try {
    await page.waitForFunction(
      () => document.querySelector('.empty-state')?.textContent?.includes('fetching the latest tier data'),
      undefined,
      {timeout: 6000}
    );
    ok('[configure-both-slow] showed the 3s progress message during the stall');
  } catch {
    fail('[configure-both-slow] never showed the "fetching the latest tier data..." progress message');
  }

  try {
    await page.waitForFunction(
      () => document.querySelector('.empty-state')?.textContent?.includes('responding slowly'),
      undefined,
      {timeout: 6000}
    );
    ok('[configure-both-slow] escalated to the 7s "responding slowly" message');
  } catch {
    fail('[configure-both-slow] never escalated to the "responding slowly" message past 7s');
  }

  let reachedPool = false;
  try {
    await page.waitForSelector('.pool-summary', {timeout: 22_000});
    reachedPool = true;
  } catch {
    fail('[configure-both-slow] pool never loaded even though the mirror was (slowly) healthy');
  }
  if (reachedPool) {
    ok(`[configure-both-slow] slow mirror still landed the pool (${Date.now() - t0}ms)`);
  }
  await page.screenshot({path: `${shotsDir}/e2e-configure-load-both-slow.png`}).catch(() => {});
  await page.close();
}

/** Scenario 2: both primary and mirror are down. The pool watchdog must
 *  surface a real error panel — not a silently-empty table forever. */
async function scenarioBothSourcesDown(browser) {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  await routeData(page, {primary: {down: true}, mirror: {down: true}});
  page.on('pageerror', error => fail(`[configure-both-down] page error: ${error.message}`));

  const t0 = Date.now();
  await gotoConfigureWithTeam(page);

  let sawError = false;
  try {
    await page.waitForSelector('.problems', {timeout: 27_000});
    sawError = true;
  } catch {
    fail('[configure-both-down] never showed an error panel — the pool table stayed silently empty');
  }
  const elapsed = Date.now() - t0;

  if (sawError) {
    ok(`[configure-both-down] surfaced the error panel within budget (${elapsed}ms)`);
    if (elapsed > 26_000) {
      fail(`[configure-both-down] error panel took ${elapsed}ms — past the watchdog's documented ceiling`);
    }
    const errorText = await page.locator('.problems').textContent();
    if (!/check your connection|reload|timed out/i.test(errorText ?? '')) {
      fail(`[configure-both-down] error text isn't actionable: "${errorText}"`);
    } else {
      ok('[configure-both-down] error text is actionable (mentions reloading/connection)');
    }
  }
  await page.screenshot({path: `${shotsDir}/e2e-configure-load-both-down.png`}).catch(() => {});
  await page.close();
}

async function main() {
  mkdirSync(shotsDir, {recursive: true});
  await withServer(async () => {
    const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});
    try {
      await scenarioSlowPrimaryRecoversViaMirror(browser);
      await scenarioBothSlowShowsProgress(browser);
      await scenarioBothSourcesDown(browser);
    } finally {
      await browser.close();
    }
  });

  if (process.exitCode) {
    console.error('\nE2E FAIL — configure load resilience walkthrough found regressions');
    process.exit(process.exitCode);
  }
  console.log('\nE2E PASS — configure load resilience walkthrough green');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
