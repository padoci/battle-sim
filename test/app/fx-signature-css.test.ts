import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {SIGNATURE_MOVES, signatureSlug} from '../../src/app/sixoh/fx';
import {FIELD_CLASSES} from '../../src/app/sixoh/useFxRestart';

/**
 * SIGNATURE_MOVES (TypeScript) and the `.fx-signature-*` rules (CSS) are
 * joined by nothing but a slug convention: `signatureSlug()` lowercases and
 * dashes a display name, and the result is dropped into a className that some
 * hand-written CSS selector had better match. Nothing typed, nothing checked —
 * a rename or a typo on either side silently degrades the move back to the
 * generic type/category animation, with no error anywhere.
 *
 * These tests are that check, in both directions.
 */
/** Comments stripped: they discuss selectors (".fx-signature-x.impact::after")
 * without declaring them, which would otherwise read as a rule named `x`. */
const css = readFileSync(new URL('../../src/app/app.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
);

/**
 * Six moves are in SIGNATURE_MOVES but deliberately have no
 * `.fx-signature-*` rule: they animate the whole field rather than a sprite,
 * so SixOhGauntlet's `fieldClasses` gives them a class on `.stage-field`
 * instead. Listed explicitly so the exemption can't quietly grow.
 */
const FIELD_LEVEL = new Set([
  'Earthquake',
  'Stealth Rock',
  'Spikes',
  'Defog',
  'Toxic Spikes',
  'Sticky Web',
]);

/** Every `.fx-signature-<slug>` mentioned anywhere in the stylesheet. */
function slugsInCss(): Set<string> {
  const found = new Set<string>();
  for (const [, slug] of css.matchAll(/\.fx-signature-([a-z0-9-]+)/g)) found.add(slug);
  return found;
}

/**
 * Whole-field flourishes that can be set in the SAME beat.
 *
 * Sharing a pseudo-element is fine for tokens that are mutually exclusive: the
 * hazard falls and the defog sweep are each keyed to one move name, and a beat
 * has exactly one move, so only one of them can ever be present. What is not
 * fine is two tokens that co-occur, because they all sit on `.stage-field` at
 * identical (0,1,0) specificity and the later one in source silently takes
 * `background`, `animation` and `z-index` from the other.
 *
 * `crit-flash` and `earthquake-shake` are both driven by the impact FX, and a
 * critical Earthquake sets both. That combination really did erase the white
 * flash until `crit-flash` moved to `::after`.
 */
const CO_OCCURRING: readonly (readonly string[])[] = [['crit-flash', 'earthquake-shake']];

describe('whole-field flourishes', () => {
  it('tokens that can share a beat do not share a pseudo-element', () => {
    // `content:` is what actually creates the box, so that is the claim.
    const claimed = (token: string, pseudo: string) =>
      new RegExp(`\\.${token}${pseudo}\\s*\\{[^}]*content\\s*:`).test(css);

    const clashes: string[] = [];
    for (const group of CO_OCCURRING) {
      for (const pseudo of ['::before', '::after']) {
        const claimants = group.filter(t => claimed(t, pseudo));
        if (claimants.length > 1) clashes.push(`${pseudo}: ${claimants.join(' + ')}`);
      }
    }
    expect(clashes, 'these field effects would erase each other in a shared beat').toEqual([]);

    // Not vacuous: every token named above really is found somewhere, so a
    // rename cannot turn this test into a no-op.
    for (const token of CO_OCCURRING.flat()) {
      expect(
        claimed(token, '::before') || claimed(token, '::after'),
        `${token} draws on no pseudo-element, so this check is inert`
      ).toBe(true);
      expect(FIELD_CLASSES).toContain(token);
    }
  });
});

describe('app.css keyframes', () => {
  it('has no duplicate @keyframes names', () => {
    // A later @keyframes silently replaces an earlier one of the same name,
    // across the whole stylesheet. In ~9000 lines with 350+ animations that is
    // very easy to do by accident and produces no error: a status-condition
    // ember loop was once shadowed by an unrelated signature move's keyframe,
    // which ended at opacity 0, so the effect simply never appeared.
    const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]);
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const n of names) {
      if (seen.has(n)) dupes.add(n);
      seen.add(n);
    }
    expect([...dupes], `these @keyframes names are defined more than once`).toEqual([]);
    expect(names.length).toBeGreaterThan(100); // the check is not vacuous
  });
});

describe('signature move FX: TypeScript list vs app.css rules', () => {
  it('every signature move resolves to a slug', () => {
    for (const move of SIGNATURE_MOVES) {
      expect(signatureSlug(move), `${move} should slugify`).toBeTruthy();
    }
  });

  it('every sprite-level signature move has a CSS rule', () => {
    const missing = [...SIGNATURE_MOVES]
      .filter(move => !FIELD_LEVEL.has(move))
      .filter(move => !slugsInCss().has(signatureSlug(move)!));
    expect(missing, `no .fx-signature-* rule for: ${missing.join(', ')}`).toEqual([]);
  });

  it('every field-level exemption is really in the move list', () => {
    const stale = [...FIELD_LEVEL].filter(move => !SIGNATURE_MOVES.has(move));
    expect(stale, `FIELD_LEVEL names not in SIGNATURE_MOVES: ${stale.join(', ')}`).toEqual([]);
  });

  it('every CSS rule maps back to a signature move', () => {
    const known = new Set([...SIGNATURE_MOVES].map(m => signatureSlug(m)!));
    // The reduced-motion block matches on `[class*='fx-signature-']`, which
    // the slug regex reads as a rule with an empty tail. Not a real slug.
    const orphans = [...slugsInCss()].filter(slug => slug && !known.has(slug));
    expect(orphans, `.fx-signature-* rules with no move behind them: ${orphans.join(', ')}`).toEqual([]);
  });
});
