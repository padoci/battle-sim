import {describe, expect, it} from 'vitest';
import {wilsonHalfWidth} from '../../src/analysis/confidence';
import {updateEma} from '../../src/run/bulkRunner';

describe('wilsonHalfWidth', () => {
  it('matches the known value at p=0.5, n=100', () => {
    expect(wilsonHalfWidth(0.5, 100)).toBeCloseTo(0.0962, 3);
  });

  it('shrinks as n grows', () => {
    const at = (n: number) => wilsonHalfWidth(0.5, n);
    expect(at(10)).toBeGreaterThan(at(50));
    expect(at(50)).toBeGreaterThan(at(500));
  });

  it('stays sane at extreme rates and tiny n (never blows past 1)', () => {
    expect(wilsonHalfWidth(0, 2)).toBeGreaterThan(0);
    expect(wilsonHalfWidth(0, 2)).toBeLessThan(1);
    expect(wilsonHalfWidth(1, 3)).toBeLessThan(1);
  });

  it('is fully uncertain with no battles', () => {
    expect(wilsonHalfWidth(0.5, 0)).toBe(1);
  });
});

describe('updateEma (live throughput smoothing)', () => {
  it('seeds from the first sample then smooths', () => {
    expect(updateEma(0, 2000)).toBe(2000);
    expect(updateEma(2000, 3000)).toBeCloseTo(0.2 * 3000 + 0.8 * 2000, 10);
  });
});
