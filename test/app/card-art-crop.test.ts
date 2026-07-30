import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {ART_RECT_OVERRIDES, cardArtEra, type ArtRect} from '../../src/data/tcgArt';
import artMap from '../../src/data/tcgArtMap.json';

/**
 * The draft cards show TCGdex card *scans* cropped down to just the
 * illustration, by a rectangle expressed as a fraction of the whole card
 * (`.card-art` in app.css). Nothing in the test suite can see whether that
 * rectangle lands on artwork — the Playwright baseline shoots the full page
 * at a 1.5% diff tolerance and six small art windows sit well under it. Use
 * `scripts/preview-card-crops.py` for that.
 *
 * What IS checkable is the geometric property the rectangles are chosen to
 * satisfy, which is the thing most likely to be broken silently by a later
 * tweak. See MIN_RATIO below.
 */
const css = readFileSync(new URL('../../src/app/app.css', import.meta.url), 'utf8');
const draft = readFileSync(
  new URL('../../src/app/screens/SixOhDraft.tsx', import.meta.url),
  'utf8'
);
const previewScript = readFileSync(
  new URL('../../scripts/preview-card-crops.py', import.meta.url),
  'utf8'
);
const tcgArtSource = readFileSync(new URL('../../src/data/tcgArt.ts', import.meta.url), 'utf8');

/**
 * `object-fit: cover` trims whichever axis overflows the box. The box's
 * aspect is `1.575 * art_h / art_w` (1.575 being `.card-art-window`'s own
 * aspect-ratio), and TCGdex scans are not one shape — 600x825 (0.727),
 * 700x990 (0.707), 734x1024 (0.717) and 600x835 (0.719) all appear in the
 * art map today.
 *
 * Keep the box narrower than the NARROWEST source and cover always trims
 * width, never height, so the top and bottom edges land exactly where
 * --art-y and --art-h put them on every card. Let the box get wider than
 * some source and the trim flips axis for that card only, drifting its
 * vertical framing by a percent or two — which is all it takes to put an
 * "Evolves from ..." banner back inside the window on a handful of cards and
 * nowhere else. That is a genuinely horrible bug to find by eye.
 *
 * 1.575 / 0.707 = 2.23 is the hard floor; 2.35 keeps margin for a source
 * shape narrower than any seen so far.
 */
const MIN_RATIO = 2.35;
const WINDOW_ASPECT = 1.575;
const NARROWEST_KNOWN_SOURCE = 700 / 990;

/** The `--art-*` rectangle each `.card-art` rule declares. */
function rectsInCss(): Record<string, ArtRect> {
  const out: Record<string, ArtRect> = {};
  for (const selector of ['card-art', 'card-art.era-mid', 'card-art.era-vintage']) {
    const block = new RegExp(`\\.${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`).exec(css);
    expect(block, `no .${selector} rule in app.css`).toBeTruthy();
    const vals = Object.fromEntries(
      [...block![1].matchAll(/--art-([xywh]):\s*([\d.]+)/g)].map(m => [m[1], Number(m[2])])
    );
    expect(
      Object.keys(vals).sort(),
      `.${selector} must declare all four --art-* values`
    ).toEqual(['h', 'w', 'x', 'y']);
    out[selector] = vals as unknown as ArtRect;
  }
  return out;
}

const describeRect = (r: ArtRect) => `x${r.x} y${r.y} w${r.w} h${r.h}`;

describe('card art crop rectangles', () => {
  it('the floor is really the point where cover flips axis', () => {
    // Guards the constant above rather than the rectangles: if someone
    // retunes .card-art-window's aspect-ratio, MIN_RATIO stops meaning what
    // its comment says and every other test here quietly weakens.
    expect(css).toContain(`aspect-ratio: ${WINDOW_ASPECT}`);
    expect(WINDOW_ASPECT / NARROWEST_KNOWN_SOURCE).toBeLessThanOrEqual(MIN_RATIO);
  });

  it('every era rectangle keeps cover trimming width, not height', () => {
    for (const [selector, rect] of Object.entries(rectsInCss())) {
      const ratio = rect.w / rect.h;
      expect(
        ratio,
        `.${selector} (${describeRect(rect)}) has w/h ${ratio.toFixed(2)}, below ${MIN_RATIO}: ` +
          `object-fit: cover will trim height instead of width on the narrower TCGdex ` +
          `scan sizes, drifting that card's vertical framing`
      ).toBeGreaterThanOrEqual(MIN_RATIO);
    }
  });

  it('every per-species override keeps the same property', () => {
    for (const [species, rect] of Object.entries(ART_RECT_OVERRIDES)) {
      const ratio = rect.w / rect.h;
      expect(
        ratio,
        `ART_RECT_OVERRIDES["${species}"] (${describeRect(rect)}) has w/h ${ratio.toFixed(2)}, ` +
          `below ${MIN_RATIO}`
      ).toBeGreaterThanOrEqual(MIN_RATIO);
      for (const [k, v] of Object.entries(rect)) {
        expect(v, `${species}.${k} should be a fraction of the card`).toBeGreaterThan(0);
        expect(v, `${species}.${k} should be a fraction of the card`).toBeLessThanOrEqual(1);
      }
      expect(rect.x + rect.w, `${species} runs off the right edge`).toBeLessThanOrEqual(1);
      expect(rect.y + rect.h, `${species} runs off the bottom edge`).toBeLessThanOrEqual(1);
    }
  });

  it('an override only exists for a species that is actually in the art map', () => {
    const stale = Object.keys(ART_RECT_OVERRIDES).filter(
      s => !(s in (artMap as Record<string, string>))
    );
    expect(stale, `overrides for species with no card art: ${stale.join(', ')}`).toEqual([]);
  });

  it('every series in the art map is classified on purpose', () => {
    // cardArtEra() defaults unknown series to the modern template, which is
    // right for a NEW set and wrong for an old one. This makes adding a
    // vintage-era card a deliberate act rather than a silent mis-crop.
    const classified = new Set(['sv', 'swsh', 'sm', 'me', 'tcgp']); // modern, by default
    const unknown = new Set<string>();
    for (const url of Object.values(artMap as Record<string, string>)) {
      const series = url.split('/')[4];
      if (!cardArtEra(url) && !classified.has(series)) unknown.add(series);
    }
    expect(
      [...unknown],
      `these TCG series fall through to the modern crop without anyone having ` +
        `checked they use the modern template — look at them in ` +
        `scripts/preview-card-crops.py, then add them to cardArtEra()`
    ).toEqual([]);
  });

  it('the preview script classifies series the same way the app does', () => {
    // scripts/preview-card-crops.py is the ONLY thing that can tell you the
    // crop lands on artwork, and it keeps its own copy of the era mapping
    // (it is standalone Python and can't import the TypeScript). A drifted
    // copy makes the contact sheet lie in the reassuring direction: it would
    // render a card with the wrong era's rectangle and look fine, while the
    // app renders it with the right one and doesn't. Assert them equal
    // rather than trusting the "kept in step with" comment.
    const setsIn = (src: string, name: string) => {
      const block = new RegExp(`${name}[^[({]*[[({]([^\\])}]*)`).exec(src);
      expect(block, `no ${name} in source`).toBeTruthy();
      return [...block![1].matchAll(/['"]([a-z0-9]+)['"]/g)].map(m => m[1]).sort();
    };
    expect(setsIn(previewScript, 'MID =')).toEqual(setsIn(tcgArtSource, 'MID_ERA_SERIES'));
    expect(setsIn(previewScript, 'VINTAGE =')).toEqual(setsIn(tcgArtSource, 'VINTAGE_SERIES'));
  });

  it('CardArt actually applies the era class and the overrides', () => {
    // The rectangles are inert unless the img carries the class.
    expect(draft).toMatch(/className=\{\[\s*'card-art',\s*cardArtEra\(url\)/);
    expect(draft).toContain('ART_RECT_OVERRIDES[species]');
    for (const prop of ['--art-x', '--art-y', '--art-w', '--art-h']) {
      expect(draft, `CardArt never sets ${prop}`).toContain(`'${prop}'`);
    }
  });
});
