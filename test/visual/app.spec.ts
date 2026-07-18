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

test('retro battle stage — chrome + sprites', async ({page}, testInfo) => {
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
  await page.waitForSelector('.hp-bar', {timeout: 30_000});

  // Snapshot the deterministic lead-in immediately: both leads out at full HP.
  // Everything that advances with the replay clock — HP fills/numbers, the log,
  // floating damage, the turn counter, the field strip — is masked, so this
  // regresses the retro *chrome* (frame, platforms, sprites), not battle state.
  await expect(page.locator('.battle-stage')).toHaveScreenshot('sixoh-battle-stage.png', {
    mask: [
      page.locator('.hp-block'),
      page.locator('.battle-log'),
      page.locator('.float-num'),
      page.locator('.turn-label'),
      page.locator('.field-strip'),
      page.locator('.message-box'),
      page.locator('.hazard-corner'),
    ],
    maxDiffPixelRatio: 0.03,
  });
});
