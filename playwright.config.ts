import {defineConfig, devices} from '@playwright/test';

/**
 * Visual-regression suite (test/visual). Separate from the functional e2e
 * walkthroughs (scripts/e2e-*.mjs), which stay on the raw playwright library.
 *
 * Baselines are committed PNGs and MUST be generated in CI (Linux + the pinned
 * Chromium build + real sprite network) — the dev sandbox can't reach the
 * sprite CDN, so locally-generated screenshots bake in blank sprites and would
 * never match. See README "Visual regression" for the bootstrap/update flow.
 */
export default defineConfig({
  testDir: './test/visual',
  // Screenshot comparison is order-independent; keep it serial so the heavy
  // battle-search flow never contends with the others for CPU (less flake).
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The "retro battle stage" test runs a real 6-pick draft (~6s) then waits
  // on an actual AI battle search (~15-20s, no mocking — it's the real
  // engine) before the battle stage even mounts. That's already close to
  // Playwright's 30s default, so a slightly loaded CI runner tips it over.
  // Give every test real headroom rather than special-casing one.
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', {open: 'never'}]] : [['list']],
  // Build once, then serve the production bundle Playwright will screenshot.
  webServer: {
    command: 'npm run build && npx vite preview --port 4400 --strictPort',
    url: 'http://localhost:4400',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:4400',
    // The app disables its attack FX under reduced-motion, so battle frames are
    // stable to screenshot; `animations: 'disabled'` below is belt-and-braces.
    reducedMotion: 'reduce',
  },
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      // Tolerate sub-pixel AA/sprite-encoding jitter; a real layout/style break
      // moves far more than 1.5% of pixels.
      maxDiffPixelRatio: 0.015,
    },
  },
  projects: [
    {name: 'desktop', use: {...devices['Desktop Chrome'], viewport: {width: 1440, height: 1000}}},
    {name: 'mobile', use: {...devices['Pixel 7'], viewport: {width: 375, height: 812}}},
  ],
});
