/**
 * Fault-injection e2e for the "Can you 6-0?" draft load path — the thing that
 * caused the "Dealing your first hand..." stuck/slow-load bug. Regular e2e
 * (e2e-six-oh.mjs) mocks data.pkmn.cc to respond instantly, by design, for
 * speed and determinism; that means a slow-but-healthy or fully-down data
 * host is structurally untestable there. This script deliberately injects
 * those conditions instead of mocking them away, and asserts the app
 * degrades the way it's supposed to: progressive status text while it's
 * slow, a bounded recovery via the mirror, and a real error panel (not an
 * infinite spinner) when nothing works — all within the documented time
 * budgets (8s per-URL timeout, 25s load watchdog).
 *
 * Usage:
 *   npm run build
 *   NODE_PATH=... CHROMIUM_PATH=... node scripts/e2e-load-resilience.mjs [--shots-dir DIR]
 */
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const PORT = 4326;
const shotsDir = process.argv.includes('--shots-dir')
  ? process.argv[process.argv.indexOf('--shots-dir') + 1]
  : 'logs';

function fail(message) {
  console.error(`E2E FAIL: ${message}`);
  process.exitCode = 1;
}
const ok = message => console.log(`ok: ${message}`);

function fixtureFor(kind) {
  const file =
    kind === 'teams'
      ? 'test/fixtures/gen9ou.teams.full.json'
      : kind === 'sets'
        ? 'test/fixtures/gen9ou.sets.full.json'
        : 'test/fixtures/stats.fixture.json';
  return readFileSync(file, 'utf8');
}

/** Routes data.pkmn.cc (primary) and the GitHub-raw mirror per-scenario. */
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

/** Scenario 1: primary times out (past the 8s per-URL timeout), mirror is
 *  healthy. The draft must still load — via the mirror — and the user must
 *  see progressive status text while waiting, not a silent freeze.
 *
 * Uses page.waitForFunction (a single in-page predicate Playwright polls
 * itself) rather than a hand-rolled `while` loop making repeated round-trip
 * locator calls — a loop like that can itself stall for many seconds under
 * local machine contention and blow through its own deadline without ever
 * detecting the state it was waiting for, which is a flakiness trap
 * independent of anything the app is doing. */
async function scenarioSlowPrimaryRecoversViaMirror(browser) {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  await routeData(page, {primary: {delayMs: 9000, down: true}, mirror: {}});
  page.on('pageerror', error => fail(`[slow-primary] page error: ${error.message}`));

  // With the staggered race, a healthy mirror wins ~1.5s after the primary
  // stalls — the user never even sees the slow-load status text. Assert the
  // FAST path: draft up in a few seconds, nowhere near the old 8s failover.
  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/#/sixoh?config=fast&seed=41`);
  let reachedDraft = false;
  try {
    await page.waitForSelector('.offer-card', {timeout: 15_000});
    reachedDraft = true;
  } catch {
    fail('[slow-primary] draft never loaded even though the mirror was healthy');
  }
  const elapsed = Date.now() - t0;
  if (reachedDraft) {
    ok(`[slow-primary] mirror won the staggered race (draft in ${elapsed}ms)`);
    // Stagger is 1.5s; generous CI headroom, but nowhere near the old 8s hop.
    if (elapsed > 7_000) {
      fail(`[slow-primary] recovery took ${elapsed}ms — the mirror should win the race in ~2s`);
    }
  }
  await page.screenshot({path: `${shotsDir}/e2e-load-slow-primary.png`}).catch(() => {});
  await page.close();
}

/** Scenario 1b: BOTH hosts crawling (alive, just slow). This is the case
 *  where the progressive status text still matters — nothing can win the
 *  race quickly, so the 3s/7s messages must show, and the slower-but-alive
 *  mirror must still land the draft inside the watchdog. */
async function scenarioBothSlowShowsProgress(browser) {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  // Mirror delay must sit between the 7s status escalation and the 8s
  // per-attempt timeout: it joins the race at ~1.5s and answers at ~8.5s.
  await routeData(page, {primary: {delayMs: 20_000, down: true}, mirror: {delayMs: 7000}});
  page.on('pageerror', error => fail(`[both-slow] page error: ${error.message}`));

  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/#/sixoh?config=fast&seed=41`);
  await page.waitForSelector('.empty-state', {timeout: 5000});

  try {
    await page.waitForFunction(
      () => document.querySelector('.empty-state')?.textContent?.includes('fetching the latest tier data'),
      undefined,
      {timeout: 6000}
    );
    ok('[both-slow] showed the 3s progress message during the stall');
  } catch {
    fail('[both-slow] never showed the "fetching the latest tier data..." progress message');
  }

  try {
    await page.waitForFunction(
      () => document.querySelector('.empty-state')?.textContent?.includes('responding slowly'),
      undefined,
      {timeout: 6000}
    );
    ok('[both-slow] escalated to the 7s "responding slowly" message');
  } catch {
    fail('[both-slow] never escalated to the "responding slowly" message past 7s');
  }

  let reachedDraft = false;
  try {
    // Mirror joins at 1.5s, answers at ~8.5s; comfortably inside the 25s
    // watchdog but past both status thresholds.
    await page.waitForSelector('.offer-card', {timeout: 20_000});
    reachedDraft = true;
  } catch {
    fail('[both-slow] draft never loaded even though the mirror was (slowly) healthy');
  }
  if (reachedDraft) {
    ok(`[both-slow] slow mirror still landed the draft (${Date.now() - t0}ms)`);
  }
  await page.screenshot({path: `${shotsDir}/e2e-load-both-slow.png`}).catch(() => {});
  await page.close();
}

/** Scenario 2: both primary and mirror are down. The load watchdog must
 *  surface the real error panel — not hang forever — within its documented
 *  25s budget, with an actionable message. */
async function scenarioBothSourcesDown(browser) {
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  await routeData(page, {primary: {down: true}, mirror: {down: true}});
  page.on('pageerror', error => fail(`[both-down] page error: ${error.message}`));

  const t0 = Date.now();
  await page.goto(`http://localhost:${PORT}/#/sixoh?config=fast&seed=41`);

  let sawError = false;
  try {
    await page.waitForSelector('.problems', {timeout: 27_000});
    sawError = true;
  } catch {
    fail('[both-down] never showed an error panel — the load hung with no way out');
  }
  const elapsed = Date.now() - t0;

  if (sawError) {
    ok(`[both-down] surfaced the error panel within budget (${elapsed}ms)`);
    if (elapsed > 26_000) {
      fail(`[both-down] error panel took ${elapsed}ms — past the 25s watchdog's documented ceiling`);
    }
    const errorText = await page.locator('.problems').textContent();
    if (!/check your connection|reload|timed out/i.test(errorText ?? '')) {
      fail(`[both-down] error text isn't actionable: "${errorText}"`);
    } else {
      ok('[both-down] error text is actionable (mentions reloading/connection)');
    }
  }
  await page.screenshot({path: `${shotsDir}/e2e-load-both-down.png`}).catch(() => {});
  await page.close();
}

/** Scenario 3 (positive control): once a load has succeeded, the IndexedDB
 *  cache means a SECOND load on the same origin is instant even with the
 *  data host completely unreachable — proving the cache layer itself works,
 *  not just the network-failure paths around it. */
async function scenarioCachedSecondLoadIsInstant(browser) {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const page = await context.newPage();
  await routeData(page, {primary: {}, mirror: {}});
  await page.goto(`http://localhost:${PORT}/#/sixoh?config=fast&seed=41`);
  await page.waitForSelector('.offer-card', {timeout: 15_000});
  ok('[cached-reload] first load (healthy network) reached the draft');

  // Now both sources go down — a naive implementation would show the error
  // panel again; the IndexedDB cache should make this a non-issue.
  await routeData(page, {primary: {down: true}, mirror: {down: true}});
  const t0 = Date.now();
  await page.reload();
  await page.waitForSelector('.offer-card, .problems', {timeout: 15_000});
  const elapsed = Date.now() - t0;
  const gotError = await page.locator('.problems').count();

  if (gotError) {
    fail('[cached-reload] reload with both sources down hit the error panel — cache is not being served');
  } else {
    ok(`[cached-reload] reload served from cache with both sources down (${elapsed}ms, no network needed)`);
    if (elapsed > 5000) {
      fail(`[cached-reload] cached reload took ${elapsed}ms — should be near-instant`);
    }
  }
  await context.close();
}

async function main() {
  mkdirSync(shotsDir, {recursive: true});
  await withServer(async () => {
    const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});
    try {
      await scenarioSlowPrimaryRecoversViaMirror(browser);
      await scenarioBothSlowShowsProgress(browser);
      await scenarioBothSourcesDown(browser);
      await scenarioCachedSecondLoadIsInstant(browser);
    } finally {
      await browser.close();
    }
  });

  if (process.exitCode) {
    console.error('\nE2E FAIL — load resilience walkthrough found regressions');
    process.exit(process.exitCode);
  }
  console.log('\nE2E PASS — load resilience walkthrough green');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
