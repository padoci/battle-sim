import reel from './landing-reel.gen9ou.json';

/**
 * A real, complete FAST-vs-FAST battle, replayed on the landing page.
 *
 * Vendored by `scripts/build-landing-reel.ts` (re-run it only to pick a
 * different battle — nothing in the build or the tests depends on the script).
 * Side 0, shown as "Your", wins.
 *
 * Kept in its own module so it stays a separate chunk: the landing screen is
 * eager, and this is ~15KB of protocol that nobody needs in order to read the
 * headline. `useLandingReel` imports it dynamically after mount.
 */
export const LANDING_REEL_LOG: string[] = (reel as {log: string[]}).log;

export const LANDING_REEL_META = {
  seed: (reel as {seed: number}).seed,
  turns: (reel as {turns: number}).turns,
  beats: (reel as {beats: number}).beats,
  durationMs: (reel as {durationMs: number}).durationMs,
};
