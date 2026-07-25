import {useCallback, useEffect, useState} from 'react';

/** How long the stage takes to dip out before a rung change. */
export const SWAP_FADE_MS = 350;

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

  // A new rung has mounted: come back in.
  useEffect(() => {
    setOut(false);
  }, [index]);

  const beginSwapOut = useCallback(() => {
    if (enabled) setOut(true);
  }, [enabled]);

  return {
    swapClass: out ? 'stage-swap swapping' : 'stage-swap',
    beginSwapOut,
    swappingOut: out,
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
  const fade = Math.min(SWAP_FADE_MS, beatMs * 0.5);
  return Math.max(0, beatMs - fade);
}
