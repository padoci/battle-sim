import {seedFromInts, type Seed} from '../engine/rng';

/** splitmix32 step — decorrelates consecutive/structured inputs. */
function mix(h: number): number {
  h = (h + 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * Deterministic PRNG seed for one search branch, distinct per matrix cell
 * (and per interior sub-cell). Feeding the same coordinates always yields
 * the same seed — search results are reproducible given `searchSeed` — but
 * no branch shares the live battle's RNG stream (see `reseed`).
 */
export function forkSeed(searchSeed: number, turn: number, i: number, j: number, k = 0): Seed {
  let h = mix(searchSeed >>> 0);
  h = mix(h ^ (turn >>> 0));
  h = mix(h ^ (i >>> 0));
  h = mix(h ^ (j >>> 0));
  h = mix(h ^ (k >>> 0));
  const a = h & 0xffff;
  const b = (h >>> 16) & 0xffff;
  const h2 = mix(h);
  return seedFromInts(a, b, h2 & 0xffff, (h2 >>> 16) & 0xffff);
}
