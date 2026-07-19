import {expect, test} from '@playwright/test';
import {GOOD_TEAM, routeData} from './_helpers';

// Every spec serves the vendored data so the render is deterministic.
test.beforeEach(async ({page}) => {
  await routeData(page);
});

test('landing — both mode cards', async ({page}) => {
  await page.goto('/');
  await page.waitForSelector('.mode-card');
  await expect(page).toHaveScreenshot('landing.png', {fullPage: true});
});

test('test your team — validated 6-mon preview', async ({page}) => {
  await page.goto('/#/test/import');
  await page.waitForSelector('.team-input');
  await page.locator('.team-input').fill(GOOD_TEAM);
  // Wait for all six mon icons so sprites/badges are in before the snapshot.
  await expect(page.locator('.preview-mon')).toHaveCount(6);
  await expect(page).toHaveScreenshot('test-your-team-preview.png', {fullPage: true});
});

test('can you 6-0? — draft board', async ({page}) => {
  // Seeded so the dealt offers are identical run to run.
  await page.goto('/#/sixoh?config=fast&seed=41');
  await page.waitForSelector('.offer-card', {timeout: 60_000});
  await expect(page.locator('.offer-card').first()).toBeVisible();
  await expect(page).toHaveScreenshot('sixoh-draft.png', {fullPage: true});
});

test('Gen 5 battle stage — chrome + sprites', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'battle chrome is captured on desktop only');

  await page.goto('/#/sixoh?config=fast&seed=41');
  await page.locator('.mode-toggle button', {hasText: 'Easy'}).click();
  await page.waitForTimeout(200);
  // Two-stage draft: pick the first offer, then its first set, six times.
  for (let i = 0; i < 6; i++) {
    await page.locator('.offer-card').first().click();
    await page.waitForSelector('.set-card', {timeout: 15_000});
    await page.locator('.set-card').first().click();
    await page.waitForTimeout(120);
  }
  await page.locator('button.primary', {hasText: 'Start the gauntlet'}).click();
  await page.waitForSelector('.battle-stage', {timeout: 120_000});
  // Drop to the slowest speed immediately so the replay clock all but stops —
  // at the default 2x, enough beats (switches, faints, boost stacking) play
  // out during Playwright's screenshot-stability polling to change on-stage
  // content between attempts, which no amount of masking can stabilize.
  await page.getByLabel('Playback speed').fill('0.1');
  await page.waitForSelector('.hp-bar', {timeout: 30_000});
  // Both mons take one beat each to switch in — give the second one time to
  // land so the screenshot isn't a coin flip on which side has rendered yet.
  await page.waitForTimeout(1_500);

  // .battle-stage is now just the dark-bezel viewport (field + message box);
  // the log/meta/playback live below it in normal page flow. Everything that
  // still advances with the replay clock inside the viewport — HP
  // fills/numbers, floating damage, the message text — is masked, so this
  // regresses the Gen 5 *chrome* (bezel, field, sprites, HP box shape), not
  // battle state.
  await expect(page.locator('.battle-stage')).toHaveScreenshot('sixoh-battle-stage.png', {
    mask: [
      page.locator('.hp-block'),
      page.locator('.float-num'),
      page.locator('.message-box'),
      page.locator('.hazard-corner'),
    ],
    maxDiffPixelRatio: 0.03,
  });
});
