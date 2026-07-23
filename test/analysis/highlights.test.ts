import {describe, expect, it} from 'vitest';
import {findBiggestHit} from '../../src/analysis/highlights';
import fixture from '../fixtures/protocol.fixture.json';

describe('findBiggestHit', () => {
  it('picks the single largest qualifying hit, not a cumulative total', () => {
    // Two hits from the same move, 40% then 60% (100% cumulative) — the
    // function must report the bigger individual hit (60%), not the sum.
    const log = [
      '|switch|p1a: Kingambit|Kingambit, M|100/100',
      '|switch|p2a: Ting-Lu|Ting-Lu|100/100',
      '|turn|1',
      '|move|p1a: Kingambit|Kowtow Cleave|p2a: Ting-Lu',
      '|-damage|p2a: Ting-Lu|60/100',
      '|move|p1a: Kingambit|Kowtow Cleave|p2a: Ting-Lu',
      '|-damage|p2a: Ting-Lu|0 fnt',
    ];
    const hit = findBiggestHit(log);
    expect(hit).toMatchObject({
      attackerSpecies: 'Kingambit',
      defenderSpecies: 'Ting-Lu',
      move: 'Kowtow Cleave',
      pct: 60,
      ohko: true,
    });
  });

  it('excludes hazard/residual/item chip damage from candidacy, even when numerically bigger', () => {
    const log = [
      '|switch|p1a: Gliscor|Gliscor, M|100/100',
      '|switch|p2a: Dragapult|Dragapult, M|100/100',
      '|turn|1',
      // A small direct hit...
      '|move|p2a: Dragapult|Shadow Ball|p1a: Gliscor',
      '|-damage|p1a: Gliscor|85/100',
      // ...followed by a bigger, but [from]-tagged, hazard tick that must not win.
      '|-damage|p1a: Gliscor|20/100|[from] Stealth Rock',
    ];
    const hit = findBiggestHit(log);
    expect(hit?.move).toBe('Shadow Ball');
    expect(hit?.pct).toBe(15);
  });

  it('flags a critical hit and a super-effective hit correctly', () => {
    const log = [
      '|switch|p1a: Zamazenta|Zamazenta|100/100',
      '|switch|p2a: Roaring Moon|Roaring Moon|100/100',
      '|turn|1',
      '|move|p2a: Roaring Moon|Acrobatics|p1a: Zamazenta',
      '|-supereffective|p1a: Zamazenta',
      '|-crit|p1a: Zamazenta',
      '|-damage|p1a: Zamazenta|5/100',
    ];
    const hit = findBiggestHit(log);
    expect(hit).toMatchObject({crit: true, superEffective: true, pct: 95, ohko: false});
  });

  it('flags ohko only when the hit actually knocks the target out', () => {
    const survives = findBiggestHit([
      '|switch|p1a: Slowking|Slowking, M|100/100',
      '|switch|p2a: Kingambit|Kingambit, M|100/100',
      '|turn|1',
      '|move|p2a: Kingambit|Sucker Punch|p1a: Slowking',
      '|-damage|p1a: Slowking|1/100',
    ]);
    expect(survives?.ohko).toBe(false);

    const faints = findBiggestHit([
      '|switch|p1a: Slowking|Slowking, M|100/100',
      '|switch|p2a: Kingambit|Kingambit, M|100/100',
      '|turn|1',
      '|move|p2a: Kingambit|Sucker Punch|p1a: Slowking',
      '|-damage|p1a: Slowking|0 fnt',
      '|faint|p1a: Slowking',
    ]);
    expect(faints?.ohko).toBe(true);
  });

  it('returns undefined when the log has no qualifying hit at all', () => {
    const log = ['|switch|p1a: Gliscor|Gliscor, M|100/100', '|switch|p2a: Dragapult|Dragapult, M|100/100', '|turn|1'];
    expect(findBiggestHit(log)).toBeUndefined();
  });

  it('does not throw on a real, full battle log and returns a sane result', () => {
    const hit = findBiggestHit((fixture as {log: string[]}).log);
    expect(hit).toBeDefined();
    expect(hit!.pct).toBeGreaterThan(0);
    expect(hit!.pct).toBeLessThanOrEqual(100);
    expect(hit!.attackerSpecies.length).toBeGreaterThan(0);
    expect(hit!.defenderSpecies.length).toBeGreaterThan(0);
  });
});
