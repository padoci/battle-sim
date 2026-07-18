import {describe, expect, it} from 'vitest';
import {clampN} from '../../src/app/clamp';

describe('clampN', () => {
  it('clamps below the minimum up to it', () => {
    expect(clampN(5, 10)).toBe(10);
    expect(clampN(-40, 30)).toBe(30);
  });

  it('clamps above 500 down to 500', () => {
    expect(clampN(503, 10)).toBe(500);
    expect(clampN(10_000, 10)).toBe(500);
  });

  it('rounds to the slider step of 10', () => {
    expect(clampN(37, 10)).toBe(40);
    expect(clampN(34, 10)).toBe(30);
    expect(clampN(45, 10)).toBe(50); // round-half-up
  });

  it('passes through in-range multiples of 10 unchanged', () => {
    expect(clampN(200, 10)).toBe(200);
  });

  it('returns NaN for non-finite input (caller reverts to current value)', () => {
    expect(clampN(Number('abc'), 10)).toBeNaN();
    expect(clampN(Infinity, 10)).toBeNaN();
  });
});
