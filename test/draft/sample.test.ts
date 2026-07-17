import {describe, expect, it} from 'vitest';
import {DRAFT_USAGE_FLOOR, nextRng, offerWeight, sampleWithoutReplacement} from '../../src/draft/sample';

describe('offerWeight', () => {
  it('softens usage with the square root and floors zero-usage mons', () => {
    expect(offerWeight(0.25)).toBeCloseTo(0.5, 10);
    expect(offerWeight(0)).toBeCloseTo(Math.sqrt(DRAFT_USAGE_FLOOR), 10);
    expect(offerWeight(0.0005)).toBe(offerWeight(0)); // below floor -> floor
    expect(offerWeight(0.25) / offerWeight(0)).toBeLessThan(20); // softened, not winner-take-all
  });
});

describe('nextRng', () => {
  it('is a pure function of its state', () => {
    const a = nextRng(42);
    const b = nextRng(42);
    expect(a).toEqual(b);
    expect(nextRng(a.state).value).not.toBe(a.value);
    expect(a.value).toBeGreaterThanOrEqual(0);
    expect(a.value).toBeLessThan(1);
  });
});

describe('sampleWithoutReplacement', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'];

  it('never repeats and returns advanced state', () => {
    const {picked, state} = sampleWithoutReplacement(items, () => 1, 4, 7);
    expect(new Set(picked).size).toBe(4);
    expect(state).not.toBe(7);
  });

  it('is deterministic per state and caps at population size', () => {
    const a = sampleWithoutReplacement(items, () => 1, 10, 99);
    const b = sampleWithoutReplacement(items, () => 1, 10, 99);
    expect(a.picked).toEqual(b.picked);
    expect(a.picked).toHaveLength(6);
  });

  it('respects weights over many draws', () => {
    let heavyFirst = 0;
    let state = 1;
    for (let i = 0; i < 500; i++) {
      const result = sampleWithoutReplacement(['heavy', 'light'], item => (item === 'heavy' ? 9 : 1), 1, state);
      state = result.state;
      if (result.picked[0] === 'heavy') heavyFirst++;
    }
    expect(heavyFirst).toBeGreaterThan(400); // ~450 expected
  });
});
