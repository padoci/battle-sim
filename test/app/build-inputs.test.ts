import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';

/**
 * `measure.html` reads its battle count and search config straight from the
 * query string, so `?battles=500&config=strong` will run a visitor's CPU flat
 * out for many minutes. It must not exist on the deployed site.
 *
 * `public/robots.txt` disallows it, but robots.txt only asks crawlers nicely —
 * omitting the page from the production build is the thing that actually makes
 * the URL 404. This test guards that, because "we removed it from the build
 * inputs" is exactly the kind of change a later refactor re-adds by accident
 * while tidying the rollup config.
 *
 * Asserted against the config source rather than a built `dist/`: the whole
 * point is to fail in the normal test run, not only after a build.
 */

const config = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');

describe('production build inputs', () => {
  it('gates the developer pages behind BUILD_TOOLS', () => {
    expect(config).toMatch(/process\.env\.BUILD_TOOLS/);
  });

  it('never lists dev.html or measure.html unconditionally', () => {
    // Both may appear only inside the BUILD_TOOLS-conditional block.
    const gated = config.slice(config.indexOf('process.env.BUILD_TOOLS'));
    const ungated = config.slice(0, config.indexOf('process.env.BUILD_TOOLS'));
    for (const page of ['dev.html', 'measure.html']) {
      expect(ungated, `${page} must not be an unconditional build input`).not.toMatch(
        new RegExp(`resolve\\(__dirname, '${page}'\\)`)
      );
      expect(gated).toMatch(new RegExp(`resolve\\(__dirname, '${page}'\\)`));
    }
  });

  it('still builds the app itself unconditionally', () => {
    const ungated = config.slice(0, config.indexOf('process.env.BUILD_TOOLS'));
    expect(ungated).toMatch(/resolve\(__dirname, 'index\.html'\)/);
  });

  it('keeps robots.txt disallowing them as belt-and-braces', () => {
    const robots = readFileSync(new URL('../../public/robots.txt', import.meta.url), 'utf8');
    expect(robots).toMatch(/Disallow: \/dev/);
    expect(robots).toMatch(/Disallow: \/measure/);
  });
});
