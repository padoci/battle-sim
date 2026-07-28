import reel from './landing-reel.gen9ou.json';
import {parseProtocol} from '../replay/parse';
import {toBeats, type Beat} from '../replay/pace';

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

/**
 * The reel's beats, built exactly as the landing page plays them.
 *
 * One builder, used by `useLandingReel` and by the test that checks the
 * vendored metadata still describes the reel. They used to construct these
 * separately, so giving the page the battle-textbox voice (which adds a
 * recall page, and therefore PAGE_MS, to every switch) silently made the
 * vendored `durationMs` describe a reel nobody plays — with the test still
 * green, because it was measuring the other one.
 *
 * `dialogue: true` and no trainer: this renders the same stage the arena
 * does, so it should say "Go! Darkrai!" rather than "Your Darkrai switched
 * in!", and the reel is an anonymous AI-vs-AI loop with no trainer to name.
 */
export function landingReelBeats(log: string[] = LANDING_REEL_LOG): Beat[] {
  return toBeats(parseProtocol(log, ['Your', 'The opposing'], {dialogue: true}));
}
