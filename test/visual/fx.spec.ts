import {expect, test} from '@playwright/test';
import {HIT_DELAY, SIGNATURE_MOVES, signatureSlug} from '../../src/app/sixoh/fx';
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

/** Build a holder containing a sprite and report where each animation landed. */
async function splitProbe(page: import('@playwright/test').Page, holderClass: string) {
  return page.evaluate(cls => {
    const host = document.createElement('div');
    host.className = 'battle-stage';
    const field = document.createElement('div');
    field.className = 'stage-field';
    const holder = document.createElement('div');
    holder.className = cls;
    const img = document.createElement('img');
    img.className = 'stage-sprite';
    holder.appendChild(img);
    field.appendChild(holder);
    host.appendChild(field);
    document.body.appendChild(host);
    const out = {
      holderAnim: getComputedStyle(holder).animationName,
      spriteAnim: getComputedStyle(img).animationName,
      // What the burst is multiplied by. `none` means it keeps its own colour.
      holderFilter: getComputedStyle(holder).filter,
    };
    host.remove();
    return out;
  }, holderClass);
}

test('the hit flash rides the sprite, not the holder', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  // `filter` on the holder also filters ::before/::after, where every burst is
  // drawn. Splitting recoil (holder) from flash (sprite) is what lets a
  // signature shape keep its type colour through the hit.
  const impact = await splitProbe(page, 'sprite-holder theirs impact fx-special');
  expect(impact.holderAnim).toBe('impactShake');
  expect(impact.spriteAnim).toBe('impactFlash');
  expect(impact.holderFilter).toBe('none');

  // Status moves are cast, not thrown: the holder must not inherit the dash.
  const status = await splitProbe(page, 'sprite-holder mine lunge-right fx-status');
  expect(status.holderAnim).toBe('none');
  expect(status.spriteAnim).toBe('statusGlow');
});

test('reduced motion still suppresses the relocated flash', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  // Moving the flash off the holder moved it out from under the existing
  // reduced-motion suppression; without the matching selectors these users
  // would newly get a brightness(2.8) strobe on every hit.
  const impact = await splitProbe(page, 'sprite-holder theirs impact fx-special');
  expect(impact.holderAnim).toBe('none');
  expect(impact.spriteAnim).toBe('none');

  const status = await splitProbe(page, 'sprite-holder mine lunge-right fx-status');
  expect(status.spriteAnim).toBe('none');
});

test('the hit is delayed until the attack arrives', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const delays = await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'battle-stage';
    const field = document.createElement('div');
    field.className = 'stage-field';
    host.appendChild(field);
    document.body.appendChild(host);
    const read = (cls: string, pseudo?: string) => {
      const el = document.createElement('div');
      el.className = cls;
      const float = document.createElement('span');
      float.className = 'float-num';
      el.appendChild(float);
      field.appendChild(el);
      const v = pseudo
        ? getComputedStyle(el, pseudo).animationDelay
        : getComputedStyle(el).animationDelay;
      const floatDelay = getComputedStyle(float).animationDelay;
      el.remove();
      return {v, floatDelay};
    };
    /** The hit flash rides the sprite, so it needs the delay too. */
    const readSprite = (cls: string) => {
      const el = document.createElement('div');
      el.className = cls;
      const img = document.createElement('img');
      img.className = 'stage-sprite';
      el.appendChild(img);
      field.appendChild(el);
      const v = getComputedStyle(img).animationDelay;
      el.remove();
      return v;
    };
    const out = {
      physical: read('sprite-holder theirs impact fx-physical', '::after').v,
      special: read('sprite-holder theirs impact fx-special', '::after').v,
      // A signature rule must not re-zero it: all 264 use the `animation`
      // shorthand, which resets animation-delay.
      signature: read('sprite-holder theirs impact fx-special fx-signature-ice-beam', '::after').v,
      critRing: read('sprite-holder theirs impact fx-crit fx-physical', '::before').v,
      element: read('sprite-holder theirs impact fx-special').v,
      sprite: readSprite('sprite-holder theirs impact fx-special'),
      floatNum: read('sprite-holder theirs impact fx-special').floatDelay,
      // ...but an entrance keeps its own delay: .lead-in sets one inside an
      // `animation` shorthand and a holder can be entering and hit at once.
      leadIn: read('sprite-holder mine impact fx-physical lead-in').v,
      noCategory: read('sprite-holder theirs impact', '::after').v,
    };
    host.remove();
    return out;
  });

  expect(delays.physical).toBe('0.14s');
  expect(delays.special).toBe('0.28s');
  expect(delays.signature, 'a signature rule re-zeroed the hit delay').toBe('0.28s');
  expect(delays.critRing).toBe('0.14s');
  expect(delays.element).toBe('0.28s');
  expect(delays.sprite, 'the defender lit up before the attack reached it').toBe('0.28s');
  expect(delays.floatNum, 'the damage number should wait for the hit too').toBe('0.28s');
  expect(delays.leadIn, 'the entrance animation kept its own delay').toBe('0.3s');
  expect(delays.noCategory, 'an uncategorised hit falls back to no delay').toBe('0s');

  // The HP block is a sibling of the holder, so BattleStage sets the variable
  // inline on it; .hp-fill then inherits. Check that path end to end.
  const hpDelay = await page.evaluate(() => {
    const block = document.createElement('div');
    block.className = 'hp-block theirs';
    block.style.setProperty('--fx-hit-delay', '0.28s');
    const bar = document.createElement('div');
    bar.className = 'hp-bar';
    const fill = document.createElement('div');
    fill.className = 'hp-fill';
    bar.appendChild(fill);
    block.appendChild(bar);
    document.body.appendChild(block);
    const v = getComputedStyle(fill).transitionDelay;
    block.remove();
    return v;
  });
  expect(hpDelay, 'HP should drain when the hit lands, not when the beat starts').toBe('0.28s');
});

test('the TypeScript hit delays match the CSS', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');
  // The HP block is a sibling of the sprite holder, so it can't inherit
  // --fx-hit-delay and BattleStage passes it inline from HIT_DELAY. That
  // duplication is only safe if the two stay equal.
  const fromCss = await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'battle-stage';
    const field = document.createElement('div');
    field.className = 'stage-field';
    host.appendChild(field);
    document.body.appendChild(host);
    const read = (cat: string) => {
      const el = document.createElement('div');
      el.className = `sprite-holder theirs impact ${cat}`;
      field.appendChild(el);
      const v = getComputedStyle(el).getPropertyValue('--fx-hit-delay').trim();
      el.remove();
      return v;
    };
    const out = {physical: read('fx-physical'), special: read('fx-special')};
    host.remove();
    return out;
  });
  // Compare seconds, not strings: a custom property comes back exactly as
  // authored in the served stylesheet, and the production minifier rewrites
  // `0.14s` to `.14s`.
  const seconds = (v: string) => parseFloat(v);
  expect(seconds(fromCss.physical)).toBeCloseTo(seconds(HIT_DELAY.physical), 5);
  expect(seconds(fromCss.special)).toBeCloseTo(seconds(HIT_DELAY.special), 5);
});

test('the sprite element survives the replay instead of remounting each beat', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'replay behaviour is viewport-independent');
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

  // Tag the live <img> and the mon it belongs to. The holder is keyed on
  // species, so a switch legitimately rebuilds it; anything else must not.
  // Beats used to bump a counter used as the React key, which destroyed and
  // rebuilt this element ~2.3x/second and left it unpainted for 13-16% of
  // frames.
  const before = await page.evaluate(() => {
    const img = document.querySelector('.sprite-holder.mine img.stage-sprite') as (HTMLImageElement & {__tag?: string}) | null;
    if (img) img.__tag = 'original';
    return {tagged: !!img, species: img?.getAttribute('alt') ?? null};
  });
  expect(before.tagged, 'expected a player sprite on the field to tag').toBe(true);

  // Several beats at the shipped default pace (a move beat is 1200ms).
  await page.waitForTimeout(5_000);

  const after = await page.evaluate(() => {
    const img = document.querySelector('.sprite-holder.mine img.stage-sprite') as (HTMLImageElement & {__tag?: string}) | null;
    return {tag: img?.__tag ?? null, species: img?.getAttribute('alt') ?? null};
  });

  // Only assert when the same mon is still out; a switch is allowed to remount.
  test.skip(after.species !== before.species, `player switched (${before.species} -> ${after.species})`);
  expect(after.tag, 'the sprite <img> was rebuilt mid-replay without a switch').toBe('original');
});

test('the KO animates instead of vanishing', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const ko = await splitProbe(page, 'sprite-holder theirs faint-drop');
  expect(ko.holderAnim, 'the holder should drop').toBe('faintDrop');
  expect(ko.spriteAnim, 'the sprite should fade out').toBe('faintFade');

  // .faint-drop, .lead-in and .switch-pop are all (0,1,0) and source order is
  // the only thing that makes the drop win. A hazard KO on a mon that just
  // switched in genuinely carries both classes.
  const both = await splitProbe(page, 'sprite-holder theirs faint-drop lead-in');
  expect(both.holderAnim, 'an entrance animation outranked the KO').toBe('faintDrop');
});

test('reduced motion suppresses the KO animation', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const ko = await splitProbe(page, 'sprite-holder theirs faint-drop');
  expect(ko.holderAnim).toBe('none');
  expect(ko.spriteAnim).toBe('none');

  const dust = await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'battle-stage';
    const field = document.createElement('div');
    field.className = 'stage-field';
    const el = document.createElement('div');
    el.className = 'sprite-holder theirs faint-drop';
    field.appendChild(el);
    host.appendChild(field);
    document.body.appendChild(host);
    const v = getComputedStyle(el, '::after').display;
    host.remove();
    return v;
  });
  expect(dust, 'the dust puff should be hidden, not merely unanimated').toBe('none');
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
