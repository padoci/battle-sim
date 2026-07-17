import {describe, expect, it} from 'vitest';
import {sampleOpponents} from '../../src/draft/opponents';

describe('sampleOpponents', () => {
  it('returns distinct indices, deterministic per seed', () => {
    const a = sampleOpponents(10, 6, 42);
    const b = sampleOpponents(10, 6, 42);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(6);
    expect(a.every(i => i >= 0 && i < 10)).toBe(true);
  });

  it('caps at population and varies across seeds', () => {
    expect(sampleOpponents(4, 6, 1)).toHaveLength(4);
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) seen.add(sampleOpponents(10, 6, seed).join(','));
    expect(seen.size).toBeGreaterThan(20);
  });

  it('is roughly uniform over many seeds', () => {
    const counts = new Array(10).fill(0);
    for (let seed = 0; seed < 500; seed++) {
      for (const index of sampleOpponents(10, 6, seed)) counts[index]++;
    }
    // Each index expected ~300 times (500 x 6/10).
    for (const count of counts) {
      expect(count).toBeGreaterThan(230);
      expect(count).toBeLessThan(370);
    }
  });
});
