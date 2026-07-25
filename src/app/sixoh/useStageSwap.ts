import {useCallback, useEffect, useState} from 'react';
import type {CSSProperties} from 'react';

/** The longest the stage ever takes to dip out before a rung change. */
export const SWAP_FADE_MS = 350;

/**
 * How long the dip may actually take at this beat.
 *
 * The clamp is the whole point: a fade that outlives the beat means the rung
 * advances mid-dip, `out` resets, and the stage springs back from partial
 * opacity instead of passing through nothing — a flicker, not a fade. The
 * beat shrinks with playback speed, so above ~2.1x a fixed 350ms fade is
 * already longer than the beat it has to fit inside.
 *
 * This has to drive the CSS duration as well as the start time. Shortening
 * only `swapOutDelayMs` moves when the dip begins while leaving it 350ms
 * long, which is exactly the mid-fade advance the clamp exists to prevent.
 */
export function swapFadeMs(beatMs: number): number {
  return Math.min(SWAP_FADE_MS, beatMs * 0.5);
}

/**
 * Dip the stage to nothing just before the run advances to the next rung, and
 * back in once it has.
 *
 * Moving from one rung to the next is a single frame today: `BattleStage` and
 * `BattleIntro` render two entirely separate subtrees, so React unmounts one
 * and mounts the other with no DOM in common and nothing to animate between.
 * A wrapper that survives the swap gives the change somewhere to happen.
 *
 * It is a dip rather than a true A-over-B dissolve, deliberately.
 * `BattleStage` renders the frame PLUS the log, meta row and speed slider,
 * while `BattleIntro` renders only the frame, so stacking them would overlap a
 * 300px viewport with a roughly 700px column.
 *
 * @param index    the current rung; a change means the swap has happened
 * @param enabled  false under reduced motion, where the caller keeps the cut
 */
export function useStageSwap(index: number, enabled: boolean) {
  const [out, setOut] = useState(false);
  const [fadeMs, setFadeMs] = useState(SWAP_FADE_MS);

  // A new rung has mounted: come back in.
  useEffect(() => {
    setOut(false);
  }, [index]);

  // The caller passes the window this dip has to fit inside; it knows the
  // beat, this hook doesn't. Defaulting keeps the no-argument call working.
  const beginSwapOut = useCallback(
    (fade: number = SWAP_FADE_MS) => {
      if (!enabled) return;
      setFadeMs(fade);
      setOut(true);
    },
    [enabled]
  );

  return {
    swapClass: out ? 'stage-swap swapping' : 'stage-swap',
    beginSwapOut,
    swappingOut: out,
    /** Hands the clamped duration to CSS so it can't disagree with the delay. */
    swapStyle: {'--swap-fade': `${Math.round(fadeMs)}ms`} as CSSProperties,
  };
}

/**
 * When to start the dip, so it finishes exactly as the rung advances.
 *
 * Clamped to half the beat, and not for looks: if the fade outlives the beat,
 * the advance lands mid-fade and the page-height change (the log and controls
 * unmounting) pops at partial opacity.
 */
export function swapOutDelayMs(beatMs: number): number {
  return Math.max(0, beatMs - swapFadeMs(beatMs));
}
