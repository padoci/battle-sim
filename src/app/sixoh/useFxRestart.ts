import {useLayoutEffect, useRef} from 'react';

/**
 * The per-hit FX classes on the sprite holder.
 *
 * Deliberately not "every FX class". `.lead-in` and `.switch-pop` are driven
 * by a 450ms JS window rather than by beats, and both carry their own
 * `animation-delay`; restarting them on every beat would re-run an entrance
 * pop two or three times mid-flight at high playback speeds. Every per-hit
 * animation — generic, per-type, and all 264 signature rules — is bound to a
 * compound selector containing one of these three, so this list is both
 * sufficient and minimal.
 */
export const HIT_CLASSES = ['impact', 'lunge-left', 'lunge-right'] as const;

/** Whole-field flourishes, which live on `.stage-field`. */
export const FIELD_CLASSES = [
  'stage-shake',
  'crit-flash',
  'earthquake-shake',
  'stealth-rock-fall',
  'spikes-fall',
  'defog-sweep',
  'toxic-spikes-fall',
  'sticky-web-spread',
] as const;

/**
 * Restart an element's CSS animations on each beat, without remounting it.
 *
 * Two identical consecutive beats (the same move twice) produce the same
 * className, so the browser sees no change and never re-runs the animation.
 * The stage used to solve that by keying the holder on a beat counter, which
 * worked but destroyed and rebuilt the `<img>` every beat: measured over 90s
 * of live battle that left a sprite unpainted for 13-16% of frames, in runs
 * up to 550ms, with the ground shadow still drawing under an empty patch of
 * field.
 *
 * `getAnimations()` cannot drive this either. It returns only *relevant*
 * animations (current or in effect), and every FX animation is `fill: none`
 * and ~0.4s against a 1200ms beat — so by the time the next beat arrives the
 * previous one is finished, not returned, and a cancel/play loop over it
 * silently iterates nothing.
 *
 * Removing the class, forcing a reflow, and re-adding it rebuilds the
 * animations through the cascade, which reaches `::before`/`::after` as well.
 *
 * @param fxKey  beat counter; a change means "play the FX again"
 * @param rate   playback rate for the restarted animations (see `usePlayback`)
 */
export function useFxRestart<T extends HTMLElement>(
  fxKey: number,
  rate: number,
  tokens: readonly string[] = HIT_CLASSES
) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const present = tokens.filter(c => el.classList.contains(c));
    if (!present.length) return; // FX-free beat (turn marker, boost, weather)

    el.classList.remove(...present);
    void el.offsetWidth; // flush: cancels the outgoing animations
    el.classList.add(...present);

    if (rate === 1) return;
    // The new animations do not exist until another style recalculation, so
    // without this second flush getAnimations() returns [] and the rate never
    // gets applied.
    void el.offsetWidth;
    for (const a of el.getAnimations({subtree: true})) a.playbackRate = rate;
  }, [fxKey, rate, tokens]);
  return ref;
}
