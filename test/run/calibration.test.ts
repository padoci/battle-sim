import {describe, expect, it} from 'vitest';
import {etaMs, formatEta, medianMs, updateEma} from '../../src/run/calibration';

describe('calibration math', () => {
  it('median is robust to a maxTurns outlier', () => {
    expect(medianMs([2000, 2200, 1900, 2100, 60_000])).toBe(2100);
    expect(medianMs([1000, 3000])).toBe(2000);
    expect(medianMs([])).toBe(0);
  });

  it('etaMs projects remaining battles only', () => {
    expect(etaMs(100, 10, 2400)).toBe(90 * 2400);
    expect(etaMs(10, 10, 2400)).toBe(0);
    expect(etaMs(5, 10, 2400)).toBe(0); // never negative
  });

  it('EMA seeds from first sample then smooths', () => {
    expect(updateEma(0, 2000)).toBe(2000);
    expect(updateEma(2000, 3000)).toBeCloseTo(0.2 * 3000 + 0.8 * 2000, 10);
  });

  it('formats ETAs at sane granularity', () => {
    expect(formatEta(12_000)).toMatch(/s$/);
    expect(formatEta(150_000)).toBe('≈ 2.5 min');
    expect(formatEta(14 * 60_000)).toBe('≈ 14 min');
  });
});
