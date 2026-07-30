/**
 * The mark exists twice: as the favicon in index.html and as `.brand::before`
 * in app.css. Neither file can import from the other, so the only thing keeping
 * them the same artwork is discipline, and the failure is quiet in the worst
 * way: the tab icon and the header logo drift apart and nobody notices, because
 * you rarely look at both at once.
 *
 * Inlining twice is still the right call over a shared /logo.svg. At ~500 bytes
 * it costs no extra request, and a `public/` file would need base-path handling
 * for the project-Pages build. This test is what makes the duplication safe.
 */
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/app/app.css', 'utf8');

/** The decoded SVG source behind a `data:image/svg+xml,...` URI. */
function svgFrom(uri: string): string {
  return decodeURIComponent(uri.replace(/^data:image\/svg\+xml,/, ''));
}

const faviconUri = /href="(data:image\/svg\+xml,[^"]+)"/.exec(html)?.[1];
const brandUri = /\.brand::before\s*\{[^}]*background-image:\s*url\("(data:image\/svg\+xml,[^"]+)"\)/.exec(
  css
)?.[1];

describe('the logo mark', () => {
  it('is present in both places', () => {
    expect(faviconUri, 'no data-URI favicon in index.html').toBeTruthy();
    expect(brandUri, 'no data-URI background on .brand::before in app.css').toBeTruthy();
  });

  it('is the same artwork in the tab as in the header', () => {
    expect(svgFrom(brandUri!)).toBe(svgFrom(faviconUri!));
  });

  it('is actually the six-over-six mark, not any old svg', () => {
    const svg = svgFrom(faviconUri!);
    // Three solid squares on top, three outlined beneath: if a future edit
    // swaps the artwork wholesale, the sync test above would still pass.
    expect(svg).toMatch(/viewBox='0 0 32 32'/);
    const solid = svg.match(/<rect x='\d+' y='7'/g) ?? [];
    const hollow = svg.match(/<rect x='[\d.]+' y='19.8'/g) ?? [];
    expect(solid, 'expected three filled squares on the top row').toHaveLength(3);
    expect(hollow, 'expected three outlined squares on the bottom row').toHaveLength(3);
    expect(svg).toContain("fill='#5B34D6'");
  });

  it('leaves no trace of the mark it replaced', () => {
    // The old favicon was a white zigzag; the old header mark was a gradient
    // square with an inset ring. Neither should still be lurking.
    expect(html).not.toContain('M8 22 L14 10');
    expect(css).not.toMatch(/\.brand::before\s*\{[^}]*linear-gradient/);
  });
});
