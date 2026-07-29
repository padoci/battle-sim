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
    // Mirrors the real tree: SpriteWithFallback always wraps the image in
    // `.sprite-idle`, and the KO drop now rides that wrapper.
    const idle = document.createElement('span');
    idle.className = 'sprite-idle';
    const img = document.createElement('img');
    img.className = 'stage-sprite';
    idle.appendChild(img);
    holder.appendChild(idle);
    field.appendChild(holder);
    host.appendChild(field);
    document.body.appendChild(host);
    const out = {
      holderAnim: getComputedStyle(holder).animationName,
      idleAnim: getComputedStyle(idle).animationName,
      spriteAnim: getComputedStyle(img).animationName,
      // What the burst is multiplied by. `none` means it keeps its own colour.
      holderFilter: getComputedStyle(holder).filter,
      holderOverflow: getComputedStyle(holder).overflowY,
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

test('idle breathing survives the playback-rate sweep', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'replay behaviour is viewport-independent');
  test.slow();

  // 4x, so useFxRestart's sweep actually runs (it is a no-op at 1x).
  await page.goto('/#/sixoh?config=fast&seed=41&speed=4');
  await page.waitForSelector('.offer-card', {timeout: 120_000});
  for (let i = 0; i < 6; i++) {
    await page.locator('.offer-card').first().click();
    await page.waitForTimeout(120);
  }
  await page.locator('button.primary', {hasText: 'Start the gauntlet'}).click();
  await page.waitForSelector('.hp-bar', {timeout: 120_000});

  // Only the static tiers breathe, and which mon is out is a property of the
  // seed, so wait for one rather than assuming. (A mon starts optimistically
  // on gen5ani and only drops to the static sprite once that 404s, so this
  // also waits out that round trip.)
  await page.waitForSelector('.sprite-idle.breathing', {timeout: 90_000});
  // Then several more beats, so plenty of hits have swept the subtree.
  await page.waitForTimeout(4_000);

  const rates = await page.evaluate(() =>
    [...document.querySelectorAll('.sprite-idle.breathing')].flatMap(el =>
      el.getAnimations().map(a => a.playbackRate)
    )
  );

  // Without this the assertion below passes vacuously whenever both mons
  // happen to have animated gen5ani sprites and so never breathe.
  expect(rates.length, 'no breathing sprite was on the field to check').toBeGreaterThan(0);
  // The sweep sets playbackRate on everything it finds. Left unfiltered it
  // would retime the breath to 4x on the first hit and never put it back,
  // because the sweep only runs on a beat.
  for (const r of rates) expect(r, 'the idle loop was retimed by the FX sweep').toBe(1);
});

test('a critical HP bar pulses, and the colour ramps instead of snapping', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const read = await page.evaluate(() => {
    const mk = (cls: string) => {
      const block = document.createElement('div');
      block.className = cls;
      const bar = document.createElement('div');
      bar.className = 'hp-bar';
      const fill = document.createElement('div');
      fill.className = 'hp-fill';
      bar.appendChild(fill);
      block.appendChild(bar);
      document.body.appendChild(block);
      const out = {
        anim: getComputedStyle(fill).animationName,
        transition: getComputedStyle(fill).transitionProperty,
        glow: getComputedStyle(bar).boxShadow,
      };
      block.remove();
      return out;
    };
    return {calm: mk('hp-block theirs'), critical: mk('hp-block theirs critical')};
  });

  expect(read.calm.anim).toBe('none');
  expect(read.critical.anim).toBe('hpCritical');
  // The colour used to snap on the frame the width changed.
  expect(read.calm.transition).toContain('background');
  expect(read.critical.glow).not.toBe(read.calm.glow);
});

test('reduced motion suppresses the low-HP pulse and the status effects', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const read = await page.evaluate(() => {
    const block = document.createElement('div');
    block.className = 'hp-block theirs critical';
    const bar = document.createElement('div');
    bar.className = 'hp-bar';
    const fill = document.createElement('div');
    fill.className = 'hp-fill';
    bar.appendChild(fill);
    block.appendChild(bar);

    const holder = document.createElement('div');
    holder.className = 'sprite-holder theirs st-brn';
    const idle = document.createElement('span');
    idle.className = 'sprite-idle breathing';
    holder.appendChild(idle);

    document.body.append(block, holder);
    const wx = document.createElement('span');
    wx.className = 'wx-layer wx-raindance';
    document.body.appendChild(wx);

    const out = {
      pulse: getComputedStyle(fill).animationName,
      breath: getComputedStyle(idle).animationName,
      condition: getComputedStyle(idle, '::after').display,
      rain: getComputedStyle(wx, '::before').display,
    };
    block.remove();
    holder.remove();
    wx.remove();
    return out;
  });

  expect(read.pulse).toBe('none');
  expect(read.breath).toBe('none');
  expect(read.condition).toBe('none');
  expect(read.rain).toBe('none');
});

test('the rung hand-off dips through opacity', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const read = await page.evaluate(() => {
    const probe = (cls: string) => {
      const el = document.createElement('div');
      el.className = cls;
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const out = {opacity: cs.opacity, prop: cs.transitionProperty, dur: cs.transitionDuration};
      el.remove();
      return out;
    };
    return {rest: probe('stage-swap'), swapping: probe('stage-swap swapping')};
  });

  expect(read.rest.opacity).toBe('1');
  expect(read.rest.prop).toContain('opacity');
  expect(read.rest.dur).not.toBe('0s');
  expect(read.swapping.opacity).toBe('0');
});

test('the win vignette spotlights whoever actually won', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const read = await page.evaluate(() => {
    const probe = (cls: string) => {
      const el = document.createElement('span');
      el.className = cls;
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const out = {anim: cs.animationName, bg: cs.backgroundImage, color: cs.backgroundColor};
      el.remove();
      return out;
    };
    return {mine: probe('win-glow win-mine'), theirs: probe('win-glow win-theirs'), tie: probe('win-glow win-tie')};
  });

  expect(read.mine.anim).toBe('winBloom');
  // A loss must spotlight THEIR side, so the two cannot be the same gradient.
  expect(read.mine.bg).toContain('gradient');
  expect(read.theirs.bg).toContain('gradient');
  expect(read.mine.bg).not.toBe(read.theirs.bg);
  // A tie has nobody to spotlight: a flat wash, no gradient.
  expect(read.tie.bg).toBe('none');
  expect(read.tie.color).not.toBe('rgba(0, 0, 0, 0)');
});

test('reduced motion keeps the win vignette but stops it blooming', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const read = await page.evaluate(() => {
    const el = document.createElement('span');
    el.className = 'win-glow win-mine';
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const out = {anim: cs.animationName, display: cs.display, opacity: cs.opacity};
    el.remove();
    return out;
  });

  expect(read.anim).toBe('none');
  // Unlike the drifting particles, a vignette frozen in place is exactly what
  // it should be, so these users keep the beat rather than losing it.
  expect(read.display).not.toBe('none');
  expect(read.opacity).toBe('1');
});

test('the camera leans toward the struck side and settles back', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const read = await page.evaluate(() => {
    const probe = (fieldCls: string, delay?: string) => {
      const host = document.createElement('div');
      host.className = 'battle-stage';
      const field = document.createElement('div');
      field.className = fieldCls;
      if (delay) field.style.setProperty('--fx-camera-delay', delay);
      const world = document.createElement('div');
      world.className = 'stage-world';
      field.appendChild(world);
      host.appendChild(field);
      document.body.appendChild(host);
      const cs = getComputedStyle(world);
      const out = {name: cs.animationName, origin: cs.transformOrigin, delay: cs.animationDelay};
      host.remove();
      return out;
    };
    return {
      theirs: probe('stage-field push-theirs'),
      mine: probe('stage-field push-mine'),
      withDelay: probe('stage-field push-theirs', '0.28s'),
      calm: probe('stage-field'),
    };
  });

  expect(read.theirs.name).toBe('cameraPush');
  expect(read.mine.name).toBe('cameraPush');
  expect(read.calm.name).toBe('none');
  // Leans opposite ways, toward each side's own sprite.
  expect(read.theirs.origin).not.toBe(read.mine.origin);
  // A crit push waits for the hit; a KO (no delay set) fires immediately.
  expect(read.theirs.delay).toBe('0s');
  expect(read.withDelay.delay).toBe('0.28s');
});

test('reduced motion suppresses the camera', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const read = await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'battle-stage';
    const field = document.createElement('div');
    field.className = 'stage-field push-theirs';
    const world = document.createElement('div');
    world.className = 'stage-world';
    field.appendChild(world);
    host.appendChild(field);
    document.body.appendChild(host);
    const cs = getComputedStyle(world);
    const out = {name: cs.animationName, scale: cs.scale};
    host.remove();
    return out;
  });

  expect(read.name).toBe('none');
  // The base declares no scale, so suppressing the animation rests at 1:1.
  expect(read.scale === 'none' || read.scale === '1').toBe(true);
});

test('the world layer fills the field and still covers with the scene', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const read = await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'battle-stage';
    host.style.width = '800px';
    const field = document.createElement('div');
    field.className = 'stage-field';
    const world = document.createElement('div');
    world.className = 'stage-world';
    world.style.backgroundImage = 'url(data:image/gif;base64,R0lGODlhAQABAAAAACw=)';
    field.appendChild(world);
    host.appendChild(field);
    document.body.appendChild(host);
    const cs = getComputedStyle(world);
    const box = world.getBoundingClientRect();
    const out = {
      position: cs.position,
      // `center/cover` came from .stage-field's `background` SHORTHAND, which
      // this element does not inherit. Without its own the scene would render
      // top-left at intrinsic size.
      size: cs.backgroundSize,
      pos: cs.backgroundPosition,
      // A static block would be height 0: every child is absolutely positioned.
      w: Math.round(box.width),
      h: Math.round(box.height),
    };
    host.remove();
    return out;
  });

  expect(read.position).toBe('absolute');
  expect(read.size).toBe('cover');
  expect(read.pos).toBe('50% 50%');
  expect(read.w).toBe(800);
  expect(read.h, 'the world collapsed, so nothing would paint').toBe(300);
});

test('a critical Earthquake keeps both its flash and its rings', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  // Both are whole-field flourishes and a critical Earthquake sets both in one
  // beat. They used to share `.stage-field::before` at equal specificity, so
  // earthquake won on source order and the white flash never rendered.
  const read = await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'battle-stage';
    const field = document.createElement('div');
    field.className = 'stage-field crit-flash earthquake-shake';
    host.appendChild(field);
    document.body.appendChild(host);
    const out = {
      before: getComputedStyle(field, '::before').animationName,
      after: getComputedStyle(field, '::after').animationName,
      afterBg: getComputedStyle(field, '::after').backgroundColor,
    };
    host.remove();
    return out;
  });

  expect(read.before).toBe('earthquakeRings');
  expect(read.after, 'the crit flash was swallowed').toBe('critFlash');
  expect(read.afterBg).toBe('rgb(255, 255, 255)');
});

test('weather and terrain can both be visible at once', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  // They used to share `.stage-field::after` at equal specificity, so terrain
  // won on source order and rain disappeared entirely whenever both were up.
  const read = await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'battle-stage';
    const field = document.createElement('div');
    field.className = 'stage-field wx-raindance terrain-electric';
    const wx = document.createElement('span');
    wx.className = 'wx-layer wx-raindance';
    const terrain = document.createElement('span');
    terrain.className = 'terrain-layer terrain-electric';
    field.append(wx, terrain);
    host.appendChild(field);
    document.body.appendChild(host);
    const out = {
      wxBg: getComputedStyle(wx).backgroundImage,
      wxTop: getComputedStyle(wx).top,
      terrainBg: getComputedStyle(terrain).backgroundColor,
      terrainTop: getComputedStyle(terrain).top,
      // The old pseudo-element must be gone, or it would paint on top.
      legacyPseudo: getComputedStyle(field, '::after').content,
      // Each layer carries its own particles, which the shared pseudo could
      // never have supported.
      wxParticles: getComputedStyle(wx, '::before').animationName,
      terrainParticles: getComputedStyle(terrain, '::before').animationName,
    };
    host.remove();
    return out;
  });

  expect(read.wxBg, 'the rain wash should still render with terrain up').toContain('gradient');
  expect(read.wxTop, 'weather covers the whole field').toBe('0px');
  expect(read.terrainBg).toBe('rgba(250, 220, 60, 0.18)');
  expect(read.terrainTop, 'terrain covers the ground only').not.toBe('0px');
  expect(read.legacyPseudo).toBe('none');
  expect(read.wxParticles).toBe('wxRain');
  expect(read.terrainParticles).toBe('terrainShimmer');
});

test('multi-hit damage numbers stack instead of piling up', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const tops = await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'battle-stage';
    const field = document.createElement('div');
    field.className = 'stage-field';
    const holder = document.createElement('div');
    holder.className = 'sprite-holder theirs impact fx-physical';
    field.appendChild(holder);
    host.appendChild(field);
    document.body.appendChild(host);
    holder.style.width = '100px';
    const read = (index?: number) => {
      const el = document.createElement('span');
      el.className = 'float-num';
      if (index !== undefined) {
        el.style.setProperty('--fx-float-index', String(index));
        el.style.setProperty('--fx-float-dx', `${(index % 2 ? 1 : -1) * 32 * Math.ceil(index / 2)}px`);
      }
      holder.appendChild(el);
      const cs = getComputedStyle(el);
      const out = {top: cs.top, left: cs.left};
      el.remove();
      return out;
    };
    const out = {first: read(), second: read(1), third: read(2), fourth: read(3)};
    host.remove();
    return out;
  });

  // The first hit must be untouched, so the overwhelmingly common single-hit
  // case renders exactly as it did before this change.
  expect(tops.first.top).toBe('-14px');
  expect(tops.first.left).toBe('50px'); // 50% of the 100px holder

  // Stacked upward...
  expect(tops.second.top).toBe('-29px');
  expect(tops.fourth.top).toBe('-59px');
  // ...and fanned alternately, because floatUp travels 26px (further than the
  // 15px step), so stacking alone would let consecutive numbers cross.
  expect(tops.second.left).toBe('82px');
  expect(tops.third.left).toBe('18px');
});

test('effectiveness scales the hit without touching any signature shape', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const read = await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'battle-stage';
    const field = document.createElement('div');
    field.className = 'stage-field';
    host.appendChild(field);
    document.body.appendChild(host);
    const probe = (cls: string) => {
      const el = document.createElement('div');
      el.className = cls;
      const img = document.createElement('img');
      img.className = 'stage-sprite';
      el.appendChild(img);
      field.appendChild(el);
      const after = getComputedStyle(el, '::after');
      const out = {
        holder: getComputedStyle(el).animationName,
        sprite: getComputedStyle(img).animationName,
        burstAnim: after.animationName,
        burstDelay: after.animationDelay,
        burstFilter: after.filter,
      };
      el.remove();
      return out;
    };
    const sig = 'fx-signature-ice-beam';
    const out = {
      neutral: probe(`sprite-holder theirs impact fx-special ${sig}`),
      superEff: probe(`sprite-holder theirs impact fx-special fx-super ${sig}`),
      resisted: probe(`sprite-holder theirs impact fx-special fx-resisted ${sig}`),
    };
    host.remove();
    return out;
  });

  expect(read.neutral.holder).toBe('impactShake');
  expect(read.superEff.holder).toBe('impactShakeHard');
  expect(read.resisted.holder).toBe('impactShakeSoft');
  expect(read.superEff.sprite).toBe('impactFlashHard');
  expect(read.resisted.sprite).toBe('impactFlashSoft');

  // The whole approach rests on this: the signature artwork must survive, and
  // the longhand overrides must not re-zero the hit delay.
  expect(read.superEff.burstAnim, 'the signature burst was clobbered').toBe('iceBeamShard');
  expect(read.resisted.burstAnim).toBe('iceBeamShard');
  expect(read.superEff.burstDelay, 'a shorthand re-zeroed the hit delay').toBe('0.28s');

  // `filter` is a channel the signature `animation` shorthand cannot reach.
  expect(read.neutral.burstFilter).toBe('none');
  expect(read.superEff.burstFilter).toContain('saturate');
  expect(read.resisted.burstFilter).toContain('saturate');
});

test('reduced motion suppresses the effectiveness treatment', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  // The trap: @media contributes no specificity, so `.impact` at (0,1,0) does
  // not suppress `.fx-super.impact` at (0,2,0). Without matching compound
  // selectors in the reduced-motion block these users get the HARDER shake.
  const superEff = await splitProbe(page, 'sprite-holder theirs impact fx-special fx-super');
  expect(superEff.holderAnim).toBe('none');
  expect(superEff.spriteAnim).toBe('none');

  const resisted = await splitProbe(page, 'sprite-holder theirs impact fx-special fx-resisted');
  expect(resisted.holderAnim).toBe('none');
  expect(resisted.spriteAnim).toBe('none');

  const ring = await page.evaluate(() => {
    const el = document.createElement('span');
    el.className = 'fx-eff';
    document.body.appendChild(el);
    const v = getComputedStyle(el).display;
    el.remove();
    return v;
  });
  expect(ring).toBe('none');
});

test('a dodge and a block wait for the attack, like an impact does', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const read = await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'battle-stage';
    const field = document.createElement('div');
    field.className = 'stage-field';
    host.appendChild(field);
    document.body.appendChild(host);
    const probe = (cls: string, pseudo?: string) => {
      const el = document.createElement('div');
      el.className = cls;
      field.appendChild(el);
      const cs = pseudo ? getComputedStyle(el, pseudo) : getComputedStyle(el);
      const out = {name: cs.animationName, delay: cs.animationDelay};
      el.remove();
      return out;
    };
    const out = {
      dodgeSpecial: probe('sprite-holder theirs dodge fx-special'),
      dodgePhysical: probe('sprite-holder theirs dodge fx-physical'),
      dodgeMine: probe('sprite-holder mine dodge fx-physical'),
      blockShield: probe('sprite-holder theirs blocked fx-special', '::after'),
    };
    host.remove();
    return out;
  });

  // Without the FLAVORED widening these get no --fx-hit-delay at all and the
  // defender reacts at beat start, while the beam is still in flight.
  expect(read.dodgeSpecial.delay).toBe('0.28s');
  expect(read.dodgePhysical.delay).toBe('0.14s');
  expect(read.dodgeSpecial.name).toBe('dodgeStep');
  // Each side ducks away from its own attacker.
  expect(read.dodgeMine.name).toBe('dodgeStepMine');
  expect(read.blockShield.name).toBe('blockGuard');
  expect(read.blockShield.delay).toBe('0.28s');
});

test('reduced motion suppresses the dodge and the block', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const read = await page.evaluate(() => {
    const host = document.createElement('div');
    host.className = 'battle-stage';
    const field = document.createElement('div');
    field.className = 'stage-field';
    host.appendChild(field);
    document.body.appendChild(host);
    const mk = (cls: string) => {
      const el = document.createElement('div');
      el.className = cls;
      const img = document.createElement('img');
      img.className = 'stage-sprite';
      el.appendChild(img);
      field.appendChild(el);
      return el;
    };
    const dodgeTheirs = mk('sprite-holder theirs dodge fx-special');
    const dodgeMine = mk('sprite-holder mine dodge fx-physical');
    const blocked = mk('sprite-holder theirs blocked fx-special');
    const out = {
      dodge: getComputedStyle(dodgeTheirs).animationName,
      // .sprite-holder.mine.dodge is (0,3,0) and would otherwise outrank the
      // reduced-motion list, which @media does not add specificity to.
      dodgeMine: getComputedStyle(dodgeMine).animationName,
      dodgeSprite: getComputedStyle(dodgeTheirs.querySelector('img')!).animationName,
      shield: getComputedStyle(blocked, '::after').display,
    };
    host.remove();
    return out;
  });

  expect(read.dodge).toBe('none');
  expect(read.dodgeMine).toBe('none');
  expect(read.dodgeSprite).toBe('none');
  expect(read.shield).toBe('none');
});

test('the KO animates instead of vanishing', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const ko = await splitProbe(page, 'sprite-holder theirs faint-drop');
  // The drop rides the wrapper, not the holder: the holder has to stay put so
  // its bottom edge (which sits on the base) can clip the sprite away.
  expect(ko.idleAnim, 'the sprite should drop out of the battle').toBe('faintDrop');
  expect(ko.holderOverflow, 'without a clip the sprite slides over open field').toBe('hidden');
  // A brief white-out, and emphatically NOT a fade: a knockout that dissolves
  // in mid-air reads as vanishing rather than dropping.
  expect(ko.spriteAnim).toBe('faintWhiteout');

  // A hazard KO on a mon that just switched in genuinely carries both classes.
  // They no longer compete: the entrance owns the holder, the drop owns the
  // wrapper, so both play instead of source order picking a winner.
  const both = await splitProbe(page, 'sprite-holder theirs faint-drop lead-in');
  expect(both.idleAnim, 'an entrance animation outranked the KO').toBe('faintDrop');
});

test('reduced motion suppresses the KO animation', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  const ko = await splitProbe(page, 'sprite-holder theirs faint-drop');
  expect(ko.holderAnim).toBe('none');
  expect(ko.idleAnim, 'the drop moved to the wrapper and needs its own entry').toBe('none');
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

test('the FX travel the real distance between the two mons, at any column width', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'this test resizes the viewport itself');
  test.slow();

  // The bug this guards: `beamShotToTheirs` translated a hardcoded 160px while
  // the gap between the sprite centres was 606px, so every special move was a
  // dot that died a quarter of the way across the field.
  //
  // The field is fluid — a fixed height across whatever column it gets — so its
  // ratio runs from about 2.9:1 on desktop to 1.6:1 on a phone, and NO constant
  // can be right at both: a `cqw` value tuned for one is wrong for the other,
  // and px is wrong for everything. `useStageGeometry` measures instead. This
  // checks the published distance against the real one at a spread of widths.
  await page.goto('/#/sixoh?config=fast&seed=41');
  await page.waitForSelector('.offer-card', {timeout: 120_000});
  for (let i = 0; i < 6; i++) {
    await page.locator('.offer-card').first().click();
    await page.waitForTimeout(120);
  }
  await page.locator('button.primary', {hasText: 'Start the gauntlet'}).click();
  await page.waitForSelector('.hp-bar', {timeout: 120_000});
  await page.waitForTimeout(1_200);

  for (const width of [1440, 1100, 800, 600, 390]) {
    await page.setViewportSize({width, height: 1000});
    await page.waitForTimeout(350);

    const geom = await page.evaluate(() => {
      const field = document.querySelector('.stage-field') as HTMLElement;
      const theirs = document.querySelector('.sprite-holder.theirs') as HTMLElement;
      const mine = document.querySelector('.sprite-holder.mine') as HTMLElement;
      // Offsets, not bounding boxes: the holders are transformed by the FX and
      // a lunge in flight would otherwise read as a change in the gap.
      const centre = (el: HTMLElement) => ({
        x: el.offsetLeft + el.offsetWidth / 2,
        y: el.offsetTop + el.offsetHeight / 2,
      });
      const t = centre(theirs);
      const m = centre(mine);
      const cs = getComputedStyle(field);
      return {
        fieldW: field.clientWidth,
        declaredX: parseFloat(cs.getPropertyValue('--gap-x')),
        declaredY: parseFloat(cs.getPropertyValue('--gap-y')),
        actualX: t.x - m.x,
        actualY: m.y - t.y,
      };
    });

    expect(geom.declaredX, `gap-x at ${width}px: the beam would stop short`).toBeCloseTo(geom.actualX, 0);
    expect(geom.declaredY, `gap-y at ${width}px: the beam would miss vertically`).toBeCloseTo(geom.actualY, 0);
    // And it is a real crossing of the field, not a twitch.
    expect(geom.actualX, `the mons are not meaningfully apart at ${width}px`).toBeGreaterThan(geom.fieldW * 0.3);
  }
});

test('the idle phase offset does not retime the KO drop', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'cascade is viewport-independent; desktop is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  // The bug this guards: the per-species breathing phase used to be an inline
  // `animation-delay` on `.sprite-idle`. Inline styles outrank every
  // stylesheet rule, so it also applied to the KO drop that shares this
  // wrapper — and a negative delay longer than faintDrop's 0.75s, with
  // `fill: forwards`, starts the animation past its own end. The fainting
  // sprite teleported off the field instead of sliding, for every species
  // whose hashed phase exceeded 750ms (most of them).
  const read = await page.evaluate(() => {
    const mk = (cls: string, phase: string) => {
      const host = document.createElement('div');
      host.className = 'battle-stage';
      const field = document.createElement('div');
      field.className = 'stage-field';
      const holder = document.createElement('div');
      holder.className = 'sprite-holder theirs faint-drop';
      const idle = document.createElement('span');
      idle.className = cls;
      idle.style.setProperty('--idle-phase', phase);
      holder.appendChild(idle);
      field.appendChild(holder);
      host.appendChild(field);
      document.body.appendChild(host);
      const cs = getComputedStyle(idle);
      const out = {name: cs.animationName, delay: cs.animationDelay, fill: cs.animationFillMode};
      host.remove();
      return out;
    };
    // A breathing (static-sprite) mon and an animated-gif one, both with a
    // phase far beyond the drop's duration.
    return {
      breathing: mk('sprite-idle breathing', '-2798ms'),
      animated: mk('sprite-idle', '-2798ms'),
      // The phase must still reach the breathing loop when nothing else is
      // happening, or the two mons on the field breathe in lockstep.
      idleOnly: (() => {
        const host = document.createElement('div');
        host.className = 'battle-stage';
        const el = document.createElement('span');
        el.className = 'sprite-idle breathing';
        el.style.setProperty('--idle-phase', '-2798ms');
        host.appendChild(el);
        document.body.appendChild(host);
        const cs = getComputedStyle(el);
        const out = {name: cs.animationName, delay: cs.animationDelay};
        host.remove();
        return out;
      })(),
    };
  });

  for (const [which, v] of Object.entries({breathing: read.breathing, animated: read.animated})) {
    expect(v.name, `${which}: the KO drop should own the wrapper`).toBe('faintDrop');
    // The drop must start at its beginning. Anything negative fast-forwards it.
    expect(
      parseFloat(v.delay),
      `${which}: the breathing phase leaked onto the KO drop (${v.delay})`
    ).toBe(0);
  }

  // ...and the offset still does its real job.
  expect(read.idleOnly.name).toBe('spriteIdle');
  expect(parseFloat(read.idleOnly.delay)).toBeLessThan(0);

  // The rules above are only half the guard: an inline style outranks all of
  // them, so the component must not set `animation-delay` on this element at
  // all. Asserted against the real stage, because that is where the
  // regression would actually live.
  await page.goto('/#/sixoh?config=fast&seed=41&speed=30');
  await page.waitForSelector('.offer-card', {timeout: 120_000});
  for (let i = 0; i < 6; i++) {
    await page.locator('.offer-card').first().click();
    await page.waitForTimeout(120);
  }
  await page.locator('button.primary', {hasText: 'Start the gauntlet'}).click();
  await page.waitForSelector('.hp-bar', {timeout: 120_000});

  const live = await page.evaluate(() => {
    const wrappers = [...document.querySelectorAll('.sprite-idle')] as HTMLElement[];
    return wrappers.map(w => ({
      cls: w.className,
      inlineDelay: w.style.animationDelay,
      phase: w.style.getPropertyValue('--idle-phase'),
      computedDelay: getComputedStyle(w).animationDelay,
    }));
  });
  expect(live.length, 'expected sprites on the field').toBeGreaterThan(0);
  for (const w of live) {
    expect(
      w.inlineDelay,
      `inline animation-delay on ${w.cls} would outrank the KO drop's own timing`
    ).toBe('');
    expect(w.phase, 'the per-species phase should ride a custom property').not.toBe('');
  }
});

test('the HP readout counts down with its own bar', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'the readout is viewport-independent');
  test.slow();

  // The bar's width is a CSS transition; the number beside it is text that
  // React sets the instant the beat applies. They used to disagree by as much
  // as 100 percentage points for over a second — on a knockout the box read
  // "0 / 317" while the bar was still full and the hit had not landed, giving
  // the result away before the animation could. Widening the drain to a
  // constant RATE (drainMs) made a pre-existing 400ms glitch three times worse.
  await page.goto('/#/sixoh?config=fast&seed=41');
  await page.waitForSelector('.offer-card', {timeout: 120_000});
  for (let i = 0; i < 6; i++) {
    await page.locator('.offer-card').first().click();
    await page.waitForTimeout(120);
  }
  await page.locator('button.primary', {hasText: 'Start the gauntlet'}).click();
  await page.waitForSelector('.hp-bar', {timeout: 120_000});

  await page.evaluate(() => {
    (window as unknown as {__gaps: number[]}).__gaps = [];
    const gaps = (window as unknown as {__gaps: number[]}).__gaps;
    const tick = () => {
      for (const b of document.querySelectorAll('.hp-block')) {
        // The departing box is mid-slide with its own frozen values.
        if (b.className.includes('hp-out')) continue;
        const fill = b.querySelector('.hp-fill');
        const track = b.querySelector('.hp-bar');
        if (!fill || !track) continue;
        const trackW = track.getBoundingClientRect().width;
        if (!trackW) continue;
        const shown = (fill.getBoundingClientRect().width / trackW) * 100;
        const num = b.querySelector('.hp-numeric')?.textContent ?? '';
        const lab = b.querySelector('.hp-label')?.textContent ?? '';
        const mNum = num.match(/(\d+)\s*\/\s*(\d+)/);
        const mLab = lab.match(/(\d+)%/);
        const claimed = mNum ? (Number(mNum[1]) / Number(mNum[2])) * 100 : mLab ? Number(mLab[1]) : null;
        if (claimed !== null) gaps.push(Math.abs(shown - claimed));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.waitForTimeout(25_000);
  const gaps: number[] = await page.evaluate(
    () => (window as unknown as {__gaps: number[]}).__gaps
  );

  expect(gaps.length, 'expected HP samples across several beats').toBeGreaterThan(500);
  const worst = Math.max(...gaps);
  // A few points of slack for rounding and for the transition and the rAF
  // counter landing on different sides of a frame.
  expect(worst, 'the HP number and its bar told different stories').toBeLessThan(12);
});

test('the pokeball toss tracks the field, not the browser window', async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'the units are viewport-independent by design; one is enough');
  await page.goto('/');
  await page.waitForSelector('.mode-card');

  // The bug this guards: the toss was briefly authored in `cqw`, which is only
  // meaningful while `.stage-field` is a query container. The field went back
  // to a fluid width and lost its `container-type`, at which point `cqw`
  // silently fell back to the VIEWPORT — the ball flew in from 21% of the
  // browser window regardless of how big the stage was, and rescaled when you
  // resized the window. Verified against production: a 400px field and a 900px
  // field both started the ball at exactly -95px, which was 21% of that
  // window's width.
  const probe = await page.evaluate(() => {
    const one = (fieldWidth: number, gapX: number, gapY: number) => {
      const host = document.createElement('div');
      host.className = 'battle-stage';
      host.style.cssText = `position:absolute;left:-9999px;top:0;width:${fieldWidth}px`;
      const field = document.createElement('div');
      field.className = 'stage-field';
      // What useStageGeometry publishes for a field this wide.
      field.style.setProperty('--gap-x', `${gapX}px`);
      field.style.setProperty('--gap-y', `${gapY}px`);
      const holder = document.createElement('div');
      holder.className = 'sprite-holder mine';
      const ball = document.createElement('span');
      ball.className = 'switch-ball';
      // Freeze on the first keyframe: that is where the ball starts its arc.
      ball.style.animationPlayState = 'paused';
      holder.appendChild(ball);
      field.appendChild(holder);
      host.appendChild(field);
      document.body.appendChild(host);
      const cs = getComputedStyle(ball);
      const m = cs.transform.match(/matrix\(([^)]+)\)/);
      const p = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
      const out = {name: cs.animationName, startTx: p[4], startTy: p[5]};
      host.remove();
      return out;
    };
    return {narrow: one(400, 240, 76), wide: one(900, 606, 88)};
  });

  expect(probe.narrow.name).toBe('ballTossMine');
  // A proportion of the gap it was given, so a wider stage throws from further.
  expect(probe.narrow.startTx).toBeCloseTo(-0.2 * 240, 0);
  expect(probe.wide.startTx).toBeCloseTo(-0.2 * 606, 0);
  expect(probe.narrow.startTy).toBeCloseTo(-0.8 * 76, 0);
  expect(probe.wide.startTy).toBeCloseTo(-0.8 * 88, 0);
  // The property that actually failed: identical starts meant it was tracking
  // something other than the stage.
  expect(
    probe.narrow.startTx,
    'the toss is the same distance whatever the stage size, so it is not tracking the stage'
  ).not.toBeCloseTo(probe.wide.startTx, 0);
});
