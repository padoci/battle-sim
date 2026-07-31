/**
 * The colour tokens are pinned by WCAG AA, not by taste, and nothing in the
 * build knows that. An eyedropper nudge to make a hint "a bit lighter" silently
 * drops it back under 4.5:1, and the only way anyone finds out is a user who
 * cannot read it. This computes the real ratios from app.css.
 *
 * It also holds two traps that cost real time to find:
 *
 *  - A badge that sits on a FIXED colour cannot take themed ink. The type
 *    badges used `var(--ink)`, which inverts in dark mode, so they rendered
 *    light-on-light at 1.46:1 (Ground) until they were pinned.
 *  - `--muted` and `--muted-2` both have to clear AA on near-white surfaces,
 *    which pushes them together. They must stay apart, or the secondary and
 *    tertiary text hierarchy collapses into one colour.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const css = readFileSync('src/app/app.css', 'utf8');

/** Relative luminance, per WCAG 2.x. */
function luminance(hex: string): number {
  const parts = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = parts.map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Read a custom property. `scope: 'dark'` reads inside the dark media block. */
function token(name: string, scope: 'light' | 'dark' = 'light'): string {
  const source =
    scope === 'dark' ? css.slice(css.indexOf('@media (prefers-color-scheme: dark)')) : css;
  const found = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(source);
  expect(found, `token --${name} (${scope}) not found in app.css`).toBeTruthy();
  return found![1].toLowerCase();
}

const AA = 4.5;

// The near-white surfaces muted text actually sits on, in light mode.
const LIGHT_SURFACES = ['#faf7fe', '#efe9f7', '#e7dff4', '#ffffff', '#f7f4ea'];
// The dark surfaces it sits on when the theme flips.
const DARK_SURFACES = ['#1f1930', '#221b35', '#2a2141', '#14101f', '#191428'];

describe('text tokens clear WCAG AA', () => {
  it('light theme: muted, muted-2 and signal-2 all clear 4.5:1 everywhere they sit', () => {
    for (const name of ['muted', 'muted-2', 'signal-2']) {
      const colour = token(name);
      for (const bg of LIGHT_SURFACES) {
        const ratio = contrast(colour, bg);
        expect(
          ratio,
          `--${name} (${colour}) on ${bg} is ${ratio.toFixed(2)}:1, under AA`
        ).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it('dark theme: muted-2 lifts far enough off the dark ground', () => {
    const colour = token('muted-2', 'dark');
    for (const bg of DARK_SURFACES) {
      const ratio = contrast(colour, bg);
      expect(
        ratio,
        `dark --muted-2 (${colour}) on ${bg} is ${ratio.toFixed(2)}:1, under AA`
      ).toBeGreaterThanOrEqual(AA);
    }
  });

  it('keeps muted and muted-2 apart, so the hierarchy survives the constraint', () => {
    // Both are squeezed toward the same darkness by AA. If they ever meet, the
    // distinction between secondary and tertiary text is gone.
    const gap = Math.abs(luminance(token('muted')) - luminance(token('muted-2')));
    expect(gap, 'muted and muted-2 have collapsed into the same colour').toBeGreaterThan(0.015);
    expect(
      luminance(token('muted')),
      'muted should stay the darker, stronger of the pair'
    ).toBeLessThan(luminance(token('muted-2')));
  });
});

describe('type badges', () => {
  const types = [...css.matchAll(/--type-([a-z]+):\s*(#[0-9a-fA-F]{6})/g)].map(m => ({
    name: m[1],
    bg: m[2].toLowerCase(),
  }));

  it('found the full type palette', () => {
    expect(types.length).toBe(18);
  });

  it('every badge is legible on its own type colour', () => {
    const onTypeLight = token('on-type-light');
    const white = '#ffffff';
    const bad: string[] = [];
    for (const {name, bg} of types) {
      // Which ink does app.css actually give this badge?
      const rule = new RegExp(
        `\\.type-badge\\.type-${name} \\{[^}]*\\}`
      ).exec(css)?.[0] ?? '';
      const ink = rule.includes('--on-type-light') ? onTypeLight : white;
      const ratio = contrast(ink, bg);
      if (ratio < AA) bad.push(`${name}: ${ink} on ${bg} = ${ratio.toFixed(2)}:1`);
    }
    expect(bad, `type badges under AA:\n${bad.join('\n')}`).toEqual([]);
  });

  it('never lets a badge take themed ink', () => {
    // `--ink` inverts between themes; the badge background does not. Using it
    // here is the bug that produced 1.46:1 on Ground in dark mode.
    const themed = types.filter(({name}) =>
      new RegExp(`\\.type-badge\\.type-${name} \\{[^}]*var\\(--ink\\)`).test(css)
    );
    expect(
      themed.map(t => t.name),
      'these badges use var(--ink), which flips with the theme over a fixed background'
    ).toEqual([]);
  });
});
