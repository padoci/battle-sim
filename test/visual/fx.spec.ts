import {expect, test} from '@playwright/test';
import {SIGNATURE_MOVES, signatureSlug} from '../../src/app/sixoh/fx';
import {routeData} from './_helpers';

/**
 * The move-FX layer had no test at all, and structurally could not get one:
 * playwright.config sets `reducedMotion: 'reduce'` globally, and app.css
 * responds by `display: none`-ing every FX pseudo-element. So every committed
 * baseline was shot with the effects switched off.
 *
 * These specs opt out of that, and assert the *cascade* rather than pixels —
 * no baseline to regenerate, no timing race, and one pass covers all 307.
 */
test.beforeEach(async ({page}) => {
  // Opt this file out of the project-wide `reducedMotion: 'reduce'`, which
  // otherwise hides the very thing under test.
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await routeData(page);
});

/** Properties a signature rule could plausibly be the reason for. */
const PROBED = [
  'animationName',
  'animationDuration',
  'animationDelay',
  'width',
  'height',
  'backgroundImage',
  'backgroundColor',
  'clipPath',
  'borderRadius',
  'boxShadow',
  'transform',
] as const;

/**
 * Measure the computed style of a holder's pseudo-elements, with and without
 * a `fx-signature-*` class, across both the states signature rules hook.
 *
 * Deliberately synthetic: the rules under test are global CSS, so this needs
 * a stylesheet and a DOM, not a running battle. That keeps it fast and
 * deterministic where a real replay would be neither.
 */
async function probe(page: import('@playwright/test').Page, slugs: string[]) {
  return page.evaluate(
    ({slugs, props}) => {
      const host = document.createElement('div');
      host.className = 'battle-stage';
      const field = document.createElement('div');
      field.className = 'stage-field';
      host.appendChild(field);
      document.body.appendChild(host);

      const states = ['impact', 'lunge-right'];
      // '' is the holder element itself: a handful of moves (U-turn, Sleep
      // Talk) reskin the lunge motion rather than drawing a pseudo-element.
      const pseudos = ['', '::before', '::after'];
      const read = (cls: string) => {
        const el = document.createElement('div');
        el.className = cls;
        el.style.setProperty('--fx-color', '#abcdef');
        field.appendChild(el);
        const out: Record<string, string> = {};
        for (const p of pseudos) {
          const cs = getComputedStyle(el, p || undefined);
          for (const prop of props) out[`${p}.${prop}`] = cs[prop as never] as string;
        }
        el.remove();
        return out;
      };

      const result: Record<string, {differs: boolean; anim: string; delay: string}> = {};
      for (const slug of slugs) {
        let differs = false;
        let anim = '';
        let delay = '';
        for (const state of states) {
          const base = `sprite-holder theirs fx-special ${state}`;
          const plain = read(base);
          const signed = read(`${base} fx-signature-${slug}`);
          for (const k of Object.keys(plain)) {
            if (plain[k] !== signed[k]) differs = true;
          }
          if (state === 'impact') {
            anim = signed['::after.animationName'];
            delay = signed['::after.animationDelay'];
          }
        }
        result[slug] = {differs, anim, delay};
      }
      host.remove();
      return result;
    },
    {slugs, props: PROBED as unknown as string[]}
  );
}

/**
 * Six moves animate the whole field (a class on `.stage-field`) rather than
 * the sprite holder, so they intentionally have no `.fx-signature-*` rule.
 * Kept in step with the same list in test/app/fx-signature-css.test.ts.
 */
const FIELD_LEVEL = new Set(['Earthquake', 'Stealth Rock', 'Spikes', 'Defog', 'Toxic Spikes', 'Sticky Web']);

const SPRITE_SLUGS = [...SIGNATURE_MOVES].filter(m => !FIELD_LEVEL.has(m)).map(m => signatureSlug(m)!);

test('every signature move actually reaches the rendered style', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const probed = await probe(page, SPRITE_SLUGS);
  const inert = SPRITE_SLUGS.filter(slug => !probed[slug].differs);
  expect(
    inert,
    `these fx-signature classes changed nothing in the computed style, so their CSS is ` +
      `unreachable (typo, lost specificity, or shadowed by a later rule): ${inert.join(', ')}`
  ).toEqual([]);

  // Sanity: the probe is capable of reporting failure.
  const nonsense = await probe(page, ['definitely-not-a-real-move']);
  expect(nonsense['definitely-not-a-real-move'].differs).toBe(false);
});

test('the impact burst is never suppressed outside reduced motion', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const probed = await probe(page, SPRITE_SLUGS);
  const silent = SPRITE_SLUGS.filter(slug => {
    const a = probed[slug].anim;
    return !a || a === 'none';
  });
  expect(silent, `no ::after animation resolves for: ${silent.join(', ')}`).toEqual([]);
});

test('the battle stage never forces horizontal page scroll', async ({page}, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'overflow only bites on a narrow viewport');
  test.slow();

  await page.goto('/#/sixoh?config=fast&seed=41');
  await page.waitForSelector('.offer-card', {timeout: 120_000});
  for (let i = 0; i < 6; i++) {
    await page.locator('.offer-card').first().click();
    await page.waitForTimeout(120);
  }
  await page.locator('button.primary', {hasText: 'Start the gauntlet'}).click();
  await page.waitForSelector('.hp-bar', {timeout: 120_000});
  await page.waitForTimeout(1_000);

  // The stage field has no width of its own; it inherits whatever the grid
  // track allows. Two 6-icon team rows used to floor that track at ~533px and
  // drag the whole document sideways, pushing the player's HP box off screen.
  //
  // Measure against documentElement.clientWidth, NOT window.innerWidth. Under
  // Chrome's mobile emulation (`isMobile: true`, which devices['Pixel 7']
  // sets) innerWidth reports the *layout* viewport, and the layout viewport
  // widens to contain overflow — with the bug present both innerWidth and
  // scrollWidth read 547, so comparing them passes vacuously. clientWidth
  // stays pinned to the real 375.
  const {scrollWidth, clientWidth} = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(clientWidth, 'sanity: the reference width should be the configured viewport').toBe(375);
  expect(
    scrollWidth,
    `document scrolls ${scrollWidth - clientWidth}px wider than the ${clientWidth}px viewport`
  ).toBeLessThanOrEqual(clientWidth);
});
