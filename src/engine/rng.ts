import type {PRNGSeed} from '@pkmn/sim';

/**
 * Seed for @pkmn/sim's battle-internal PRNG (damage rolls, secondary
 * effects). The legacy `'n,n,n,n'` string form is accepted by the sim.
 */
export type Seed = PRNGSeed;

export function seedFromInts(a: number, b: number, c: number, d: number): Seed {
  return `${a},${b},${c},${d}` as Seed;
}

export function randomSeed(): Seed {
  const int16 = () => Math.floor(Math.random() * 0x10000);
  return seedFromInts(int16(), int16(), int16(), int16());
}

/**
 * Our own deterministic randomness for choice-level decisions (random
 * playouts, equilibrium sampling). Battle-internal RNG stays @pkmn/sim's
 * seeded PRNG — this seam exists so *our* decisions are reproducible too
 * (search spec §8).
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
}

/** mulberry32 — tiny, fast, good enough for choice sampling. */
export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  return {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
    },
  };
}

/** Pick a uniform element (undefined only for an empty list). */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng.next() * items.length))];
}
