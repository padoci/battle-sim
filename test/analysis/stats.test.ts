import {describe, expect, it} from 'vitest';
import {aggregateMatchup, rollUpByArchetype, summarize, type RecordedBattle} from '../../src/analysis/stats';
import type {ArchetypeResult} from '../../src/analysis/archetype';
import type {BattleResult} from '../../src/search/runner';
import type {BattleStats} from '../../src/search/stats';

const archetype = (label = 'Balance'): ArchetypeResult => ({
  primary: label === 'Rain' ? 'rain' : 'balance',
  label,
  features: {offensiveCount: 2, defensiveCount: 2, offensiveMons: [], defensiveMons: []},
});

function battle(
  winner: 0 | 1 | null,
  stats: Partial<BattleStats> = {}
): RecordedBattle {
  const result: BattleResult = {
    winner,
    turns: 30,
    decisions: 30,
    nodes: 0,
    msSearch: 0,
    msTable: 0,
    msPerDecision: {mean: 0, p50: 0, p95: 0},
    nodesPerDecision: 0,
    stats: {
      faints: [],
      damageDealtFrac: [{}, {}],
      speedRace: {fasterCounts: [0, 0], ties: 0},
      ...stats,
    },
  };
  return {teamId: 't1', result};
}

describe('aggregateMatchup', () => {
  it('computes win rate, faint patterns, workhorses, and speed race', () => {
    const battles: RecordedBattle[] = [
      battle(0, {
        faints: [{side: 0, speciesId: 'gliscor', turn: 5, causeSpeciesId: 'darkrai', causeKind: 'move'}],
        damageDealtFrac: [{kingambit: 2.5}, {darkrai: 1.8}],
        speedRace: {fasterCounts: [10, 20], ties: 0},
      }),
      battle(1, {
        faints: [
          {side: 0, speciesId: 'gliscor', turn: 3, causeSpeciesId: 'darkrai', causeKind: 'move'},
          {side: 0, speciesId: 'kingambit', turn: 9, causeKind: 'residual'},
        ],
        damageDealtFrac: [{kingambit: 1.0}, {darkrai: 2.2, kingambit: 0.5}],
        speedRace: {fasterCounts: [5, 25], ties: 0},
      }),
      battle(0, {speedRace: {fasterCounts: [15, 15], ties: 0}}),
    ];
    const agg = aggregateMatchup('t1', 'Team One', archetype(), battles);

    expect(agg.winRate).toBeCloseTo(2 / 3, 10);
    expect(agg.earliestFaints[0]).toMatchObject({speciesId: 'gliscor', faintCount: 2, meanTurn: 4, topCause: 'darkrai'});
    expect(agg.mostWork[0]).toMatchObject({speciesId: 'darkrai', totalDamageFrac: 4});
    expect(agg.speedRaceWinRate).toBeCloseTo(30 / 90, 10);
    // carriedBy counts only wins (battles 1 and 3).
    expect(agg.carriedBy[0]).toMatchObject({speciesId: 'kingambit', damageFracInWins: 2.5});
  });
});

describe('rollUpByArchetype + summarize', () => {
  it('groups matchups, counts distinct opponents, sorts worst-first', () => {
    const rain = aggregateMatchup('r1', 'Rain One', archetype('Rain'), [battle(1), battle(1), battle(0)]);
    const rain2 = aggregateMatchup('r2', 'Rain Two', archetype('Rain'), [battle(1)]);
    const bal = aggregateMatchup('b1', 'Bal', archetype(), [battle(0), battle(0)]);
    const cards = rollUpByArchetype([bal, rain, rain2]);

    expect(cards[0].archetype).toBe('rain');
    expect(cards[0].winRate).toBeCloseTo(0.25, 10);
    expect(cards[0].distinctOpponents).toBe(2);
    expect(cards[1].archetype).toBe('balance');
    expect(cards[1].winRate).toBe(1);

    const overall = summarize(cards, [bal, rain, rain2]);
    expect(overall.battles).toBe(6);
    expect(overall.winRate).toBeCloseTo(3 / 6, 10);
    expect(overall.verdict).toMatch(/Rain/);
  });
});

describe('aggregateMatchup — threaded signals (chip faints, KOs scored, overall damage)', () => {
  it('counts hazard/residual chip faints per species', () => {
    const agg = aggregateMatchup('t1', 'Opp', archetype(), [
      battle(1, {
        faints: [
          {side: 0, speciesId: 'gliscor', turn: 4, causeKind: 'hazard'},
          {side: 0, speciesId: 'gliscor', turn: 9, causeSpeciesId: 'darkrai', causeKind: 'move'},
          {side: 0, speciesId: 'kingambit', turn: 12, causeKind: 'residual'},
        ],
      }),
    ]);
    const gliscor = agg.earliestFaints.find(f => f.speciesId === 'gliscor')!;
    const kingambit = agg.earliestFaints.find(f => f.speciesId === 'kingambit')!;
    expect(gliscor.chipFaints).toBe(1);
    expect(gliscor.faintCount).toBe(2);
    expect(kingambit.chipFaints).toBe(1);
  });

  it('credits your mons with opponent KOs (side-1 move faints only)', () => {
    const agg = aggregateMatchup('t1', 'Opp', archetype(), [
      battle(0, {
        faints: [
          {side: 1, speciesId: 'pelipper', turn: 3, causeSpeciesId: 'kingambit', causeKind: 'move'},
          {side: 1, speciesId: 'barraskewda', turn: 7, causeSpeciesId: 'kingambit', causeKind: 'move'},
          {side: 1, speciesId: 'zapdos', turn: 9, causeKind: 'hazard'}, // chip — nobody credited
          {side: 0, speciesId: 'gliscor', turn: 5, causeSpeciesId: 'zapdos', causeKind: 'move'},
        ],
      }),
    ]);
    expect(agg.kosScored).toEqual([{speciesId: 'kingambit', count: 2}]);
  });

  it('records overall damage (dealtBy) in losses too, and the race sample size', () => {
    const agg = aggregateMatchup('t1', 'Opp', archetype(), [
      battle(1, {
        damageDealtFrac: [{gliscor: 0.8}, {darkrai: 2.0}],
        speedRace: {fasterCounts: [3, 7], ties: 2},
      }),
    ]);
    // Lost the game: carriedBy stays empty, dealtBy still records the output.
    expect(agg.carriedBy).toEqual([]);
    expect(agg.dealtBy).toEqual([{speciesId: 'gliscor', totalDamageFrac: 0.8}]);
    expect(agg.raceDecisions).toBe(12);
    expect(agg.speedRaceWinRate).toBeCloseTo(3 / 12, 10);
  });
});
