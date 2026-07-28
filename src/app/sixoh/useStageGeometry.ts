import {useLayoutEffect, type RefObject} from 'react';

/**
 * Publish the stage's real geometry onto the field as custom properties, so
 * the FX can travel the actual distance between the two Pokemon.
 *
 * The field is fluid: a fixed height stretched across whatever column it is
 * given, so its width-to-height ratio is about 2.9:1 on a desktop column and
 * 1.6:1 on a phone. Nothing container-relative can describe the gap between
 * the sprites at both — a `cqw` constant tuned for one is wrong for the other,
 * and a px constant is wrong for everything. That is exactly how
 * `beamShotToTheirs` came to travel 160px of a 606px gap, so every special
 * move was a dot that died a quarter of the way across the field.
 *
 * Measuring removes the constant entirely: whatever the column does, the beam
 * lands on the defender.
 *
 * Reads `offsetLeft`/`offsetTop` rather than `getBoundingClientRect`, because
 * the holders are transformed by the FX themselves — a lunge in flight would
 * otherwise feed its own displacement back in and make the gap wobble mid
 * animation. Offsets are layout values and ignore transforms.
 */
export function useStageGeometry(
  fieldRef: RefObject<HTMLElement>,
  /** Re-measure when the mons change (a switch rebuilds the holders). */
  token: unknown
): void {
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;

    const apply = () => {
      const w = field.clientWidth;
      const h = field.clientHeight;
      if (!w || !h) return;
      const theirs = field.querySelector<HTMLElement>('.sprite-holder.theirs');
      const mine = field.querySelector<HTMLElement>('.sprite-holder.mine');
      if (!theirs || !mine) return;

      const centre = (el: HTMLElement) => ({
        x: el.offsetLeft + el.offsetWidth / 2,
        y: el.offsetTop + el.offsetHeight / 2,
      });
      const t = centre(theirs);
      const m = centre(mine);

      const set = (name: string, value: string) => field.style.setProperty(name, value);
      // Travel distances, in px: attacker -> defender.
      set('--gap-x', `${(t.x - m.x).toFixed(1)}px`);
      set('--gap-y', `${(m.y - t.y).toFixed(1)}px`);
      // Where each mon stands, as a share of the field — the platforms sit on
      // these, and the whole-field strike wash centres on them.
      set('--mon-theirs-x', `${((t.x / w) * 100).toFixed(2)}%`);
      set('--mon-theirs-y', `${((t.y / h) * 100).toFixed(2)}%`);
      set('--mon-mine-x', `${((m.x / w) * 100).toFixed(2)}%`);
      set('--mon-mine-y', `${((m.y / h) * 100).toFixed(2)}%`);
    };

    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(field);
    return () => observer.disconnect();
  }, [fieldRef, token]);
}
