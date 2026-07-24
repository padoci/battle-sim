import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {SIGNATURE_MOVES, signatureSlug} from '../../src/app/sixoh/fx';

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
const css = readFileSync(new URL('../../src/app/app.css', import.meta.url), 'utf8');

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
