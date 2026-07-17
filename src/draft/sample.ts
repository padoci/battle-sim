/**
 * Draft-offer sampling (ui-spec §4b): usage-weighted but softened for
 * variety. `usage^ALPHA` with ALPHA=1 hands you the same S-tier faces
 * every run and ALPHA→0 approaches uniform; 0.5 is the spec's starting
 * point. The floor keeps zero/low-usage pool mons surfacing at all (many
 * pool species have no stats entry → usageWeighted 0). Both are the
 * tunables the taste gate may adjust (spec §9.1).
 */
export const DRAFT_ALPHA = 0.5;
export const DRAFT_USAGE_FLOOR = 0.001;

export function offerWeight(usageWeighted: number): number {
  return Math.max(usageWeighted, DRAFT_USAGE_FLOOR) ** DRAFT_ALPHA;
}

/**
 * mulberry32 with EXPLICIT state (same math as engine/rng's makeRng) so a
 * DraftState is a serializable value and drafting is a pure reducer.
 */
export function nextRng(state: number): {value: number; state: number} {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return {value: ((t ^ (t >>> 14)) >>> 0) / 2 ** 32, state: s};
}

/**
 * Weighted sampling WITHOUT replacement: draw, remove, renormalize.
 * Deterministic given rngState; returns the advanced state.
 */
export function sampleWithoutReplacement<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  count: number,
  rngState: number
): {picked: T[]; state: number} {
  const remaining = [...items];
  const picked: T[] = [];
  let state = rngState;

  while (picked.length < Math.min(count, items.length) && remaining.length > 0) {
    const weights = remaining.map(weightOf);
    const total = weights.reduce((a, b) => a + b, 0);
    const step = nextRng(state);
    state = step.state;
    let roll = step.value * total;
    let index = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      roll -= weights[i];
      if (roll < 0) {
        index = i;
        break;
      }
    }
    picked.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return {picked, state};
}
