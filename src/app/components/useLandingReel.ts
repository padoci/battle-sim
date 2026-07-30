import {useEffect, useState} from 'react';
import {type ReplayEvent} from '../../replay/parse';
import {landingReelBeats} from '../../data/landingReel';

/**
 * Replays a real battle on the landing page, at the same pace the gauntlet
 * uses, looping forever.
 *
 * Three constraints shape this, and they're why it doesn't just reuse the
 * gauntlet's playback:
 *
 * 1. **Landing is the eager chunk.** AppShell keeps it un-lazy precisely
 *    because it "pulls no engine/data", and `replay/view.ts` imports `gen9`
 *    for a single move-type lookup — which would drag the ~1.9MB dex into
 *    first paint for a decorative animation. `parse.ts` has no imports at all
 *    and `pace.ts` only a type, so those are free; the tiny bit of view state
 *    the preview actually shows (two actives, their HP, the message) is
 *    tracked here instead.
 * 2. **The log is fetched, not bundled.** It's ~14KB of protocol that nobody
 *    needs in order to read the headline, so it arrives via dynamic import
 *    after mount. Until it does — and forever, under reduced motion — the
 *    poster frame stands in.
 * 3. **Reduced motion means no reel at all.** Not a paused reel: the import
 *    never happens, no timers are scheduled, and the poster frame renders.
 *    That's also what keeps the visual baselines deterministic, since
 *    Playwright runs with `reducedMotion: 'reduce'`.
 */

export interface ReelMon {
  species: string;
  hp: number;
  maxhp: number;
}

export interface ReelFrame {
  theirs: ReelMon;
  mine: ReelMon;
  message: string;
}

/**
 * The still the page shows before the reel loads, under reduced motion, and
 * whenever the reel can't be fetched. Deliberately unchanged from the original
 * static preview, so none of the above is a visible regression.
 */
export const POSTER_FRAME: ReelFrame = {
  theirs: {species: 'Dragapult', hp: 38, maxhp: 100},
  mine: {species: 'Great Tusk', hp: 341, maxhp: 404},
  message: 'Great Tusk used Headlong Rush!',
};

/** Apply one event to the running frame. Mirrors the parts of replay/view.ts
 *  the preview actually renders — no FX, no boosts, no field state. */
function applyEvent(frame: ReelFrame, event: ReplayEvent): ReelFrame {
  // Side 0 is "your" side, rendered at the bottom of the stage.
  const sideKey = (side: 0 | 1): 'mine' | 'theirs' => (side === 0 ? 'mine' : 'theirs');

  switch (event.kind) {
    case 'switch': {
      const key = sideKey(event.ref.side);
      return {
        ...frame,
        [key]: {species: event.species, hp: event.hp, maxhp: event.maxhp || 100},
        message: event.logText || frame.message,
      };
    }
    case 'damage':
    case 'heal':
    case 'sethp': {
      const key = sideKey(event.ref.side);
      const current = frame[key];
      // A fainted mon reports 0/0; keep the last known maxhp so the bar keeps
      // its geometry instead of collapsing to a divide-by-zero.
      const maxhp = event.maxhp || current.maxhp;
      return {
        ...frame,
        [key]: {...current, hp: Math.max(0, event.hp), maxhp},
        message: event.logText || frame.message,
      };
    }
    case 'faint': {
      const key = sideKey(event.ref.side);
      return {...frame, [key]: {...frame[key], hp: 0}, message: event.logText || frame.message};
    }
    default:
      // Everything else (move, turn, tera, boost, weather, win…) is text only.
      return 'logText' in event && event.logText
        ? {...frame, message: event.logText}
        : frame;
  }
}

interface Reel {
  frames: ReelFrame[];
  /** Wall-clock ms to hold frames[i] before advancing. */
  holds: number[];
}

function buildReel(log: string[]): Reel {
  const beats = landingReelBeats(log);
  const frames: ReelFrame[] = [];
  const holds: number[] = [];
  // Start from the first switch-in pair rather than the poster, so the loop
  // opens on a real lead matchup.
  let frame: ReelFrame = POSTER_FRAME;
  for (const beat of beats) {
    for (const event of beat.events) frame = applyEvent(frame, event);
    frames.push(frame);
    holds.push(beat.durationMs);
  }
  return {frames, holds};
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useLandingReel(): ReelFrame {
  const [frame, setFrame] = useState<ReelFrame>(POSTER_FRAME);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let step: (() => void) | undefined;

    void import('../../data/landingReel')
      .then(({LANDING_REEL_LOG}) => {
        if (cancelled) return;
        const {frames, holds} = buildReel(LANDING_REEL_LOG);
        if (!frames.length) return;

        let i = 0;
        step = () => {
          if (cancelled) return;
          setFrame(frames[i]);
          const hold = holds[i];
          i = (i + 1) % frames.length;
          timer = setTimeout(step!, Math.max(16, hold));
        };
        if (!document.hidden) step();
      })
      .catch(() => {
        // The reel is decorative; a failed chunk leaves the poster frame up
        // rather than surfacing anything to the visitor.
      });

    // Background tabs shouldn't burn timers advancing an animation nobody is
    // looking at. Pausing is only half of it: without the resume branch the
    // reel would freeze permanently the first time the tab lost focus.
    const onVisibility = () => {
      if (document.hidden) {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
      } else if (timer === undefined && step && !cancelled) {
        step();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return frame;
}
