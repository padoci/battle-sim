import {describe, expect, it} from 'vitest';
import {drawSchedule, initSwrr, nextTeam, type PoolEntryConfig} from '../../src/run/pool';

function entry(teamId: string, weight: number, enabled = true): PoolEntryConfig {
  return {teamId, teamName: teamId, team: [], weight, enabled};
}

describe('smooth weighted round-robin', () => {
  it('is proportional at every prefix for weights 5:1:1', () => {
    const state = initSwrr([entry('a', 5), entry('b', 1), entry('c', 1)]);
    const picks = drawSchedule(state, 70);
    // Every prefix of length k should contain ~k*5/7 'a's, within 1.
    for (let k = 7; k <= 70; k += 7) {
      const prefix = picks.slice(0, k);
      const aCount = prefix.filter(p => p === 'a').length;
      expect(Math.abs(aCount - (k * 5) / 7)).toBeLessThanOrEqual(1);
      expect(prefix.filter(p => p === 'b').length).toBeGreaterThanOrEqual(k / 7 - 1);
    }
  });

  it('never starves a low-weight entry and spreads picks smoothly', () => {
    const state = initSwrr([entry('big', 9), entry('small', 1)]);
    const picks = drawSchedule(state, 20);
    expect(picks.filter(p => p === 'small')).toHaveLength(2);
    // The two 'small' picks are far apart (smoothness, not front/back-loaded).
    const positions = picks.map((p, i) => (p === 'small' ? i : -1)).filter(i => i >= 0);
    expect(positions[1] - positions[0]).toBeGreaterThanOrEqual(8);
  });

  it('resuming a state continues the same schedule (10 then 10 === fresh 20)', () => {
    const pool = [entry('a', 3), entry('b', 2), entry('c', 1)];
    const fresh = drawSchedule(initSwrr(pool), 20);
    const resumed = initSwrr(pool);
    const first = drawSchedule(resumed, 10);
    const second = drawSchedule(resumed, 10);
    expect([...first, ...second]).toEqual(fresh);
  });

  it('skips disabled and zero-weight entries; throws on an empty pool', () => {
    const state = initSwrr([entry('a', 1), entry('b', 0), entry('c', 5, false)]);
    expect(new Set(drawSchedule(state, 10))).toEqual(new Set(['a']));
    expect(() => nextTeam(initSwrr([entry('x', 0)]))).toThrow(/empty/);
  });
});
