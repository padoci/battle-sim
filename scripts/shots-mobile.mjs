/**
 * Stage 5 mobile + reduced-motion screenshot pass (375x812). Not an
 * assertion suite — captures the quality-floor surfaces for review.
 *
 * Usage:
 *   npm run build
 *   NODE_PATH=/opt/node22/lib/node_modules CHROMIUM_PATH=/opt/pw-browsers/chromium \
 *     node scripts/shots-mobile.mjs [--shots-dir DIR]
 */
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {chromium} = require('playwright');

const PORT = 4324;
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
  // Keep the external sample-teams fetch hermetic (empty index -> base pool).
  await page.route(/crob\.at\/api\/samples\/gen9ou/, route => {
    route.fulfill({status: 200, contentType: 'application/json', body: '[]'});
  });
}

async function main() {
  mkdirSync(shotsDir, {recursive: true});
  const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {stdio: 'ignore'});
  await new Promise(resolve => setTimeout(resolve, 3000));

  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined});
  try {
    // Mobile viewport.
    const page = await browser.newPage({viewport: {width: 375, height: 812}});
    await routeData(page);

    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForSelector('.mode-card');
    await page.screenshot({path: `${shotsDir}/mobile-landing.png`, fullPage: true});
    console.log('shot: mobile-landing');

    await page.goto(`http://localhost:${PORT}/#/sixoh?config=fast&seed=41`);
    await page.waitForSelector('.offer-card', {timeout: 60_000});
    await page.waitForTimeout(600);
    await page.screenshot({path: `${shotsDir}/mobile-draft.png`, fullPage: true});
    console.log('shot: mobile-draft');

    // Retro battle stage: Easy mode (fast, random early opponent), draft (one
    // click per bundle — cards show a single committed build), start the
    // gauntlet, capture the first battle.
    await page.locator('.mode-toggle button', {hasText: 'Easy'}).click();
    await page.waitForTimeout(200);
    for (let i = 0; i < 6; i++) {
      await page.locator('.offer-card').first().click();
      await page.waitForTimeout(120);
    }
    await page.locator('button.primary', {hasText: 'Start the gauntlet'}).click();
    // The battle intro renders `.battle-stage` immediately, so the real
    // stage's signal is the HP bar — give IT the full first-search budget
    // (same fix as e2e-six-oh.mjs when the intro landed).
    await page.waitForSelector('.hp-bar', {timeout: 150_000});
    await page.waitForTimeout(1500);
    await page.screenshot({path: `${shotsDir}/mobile-battle.png`, fullPage: true});
    console.log('shot: mobile-battle');

    await page.goto(`http://localhost:${PORT}/#/test/import`);
    await page.waitForSelector('.team-input');
    await page.locator('.team-input').fill(GOOD_TEAM);
    await page.waitForSelector('.team-preview-row');
    await page.screenshot({path: `${shotsDir}/mobile-import.png`, fullPage: true});
    console.log('shot: mobile-import');
    await page.close();

    // Desktop reduced-motion sanity (cards must stay visible, not stuck hidden).
    const rm = await browser.newPage({viewport: {width: 1440, height: 1000}});
    await rm.emulateMedia({reducedMotion: 'reduce'});
    await routeData(rm);
    await rm.goto(`http://localhost:${PORT}/#/sixoh?config=fast&seed=9`);
    await rm.waitForSelector('.offer-card', {timeout: 60_000});
    await rm.waitForTimeout(400);
    const visible = await rm.locator('.offer-card').first().isVisible();
    const opacity = await rm.locator('.offer-card').first().evaluate(el => getComputedStyle(el).opacity);
    if (!visible || Number(opacity) < 0.99) {
      console.error(`FAIL: reduced-motion left a draft card hidden (opacity ${opacity})`);
      process.exit(1);
    }
    console.log(`ok: reduced-motion draft cards fully visible (opacity ${opacity})`);
    await rm.screenshot({path: `${shotsDir}/reduced-motion-draft.png`, fullPage: true});
    console.log('shot: reduced-motion-draft');
    await rm.close();

    console.log('\nMOBILE PASS');
  } finally {
    await browser.close();
    preview.kill();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
