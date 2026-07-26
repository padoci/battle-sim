import {describe, expect, it} from 'vitest';
import {
  aggregateMatchup,
  cardRecord,
  MIN_VERDICT_BATTLES,
  rollUpByArchetype,
  summarize,
  type RecordedBattle,
} from '../../src/analysis/stats';
import type {ArchetypeResult} from '../../src/analysis/archetype';
import type {BattleResult} from '../../src/search/runner';
import type {BattleStats} from '../../src/search/stats';

const archetype = (label = 'Balance'): ArchetypeResult => ({
  primary: label === 'Rain' ? 'rain' : 'balance',
  label,
  features: {offensiveCount: 2, defensiveCount: 2, offensiveMons: [], defensiveMons: [], keyMons: []},
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

describe('cardRecord', () => {
  it('sums W-L-D across a card\'s matchups (cards only carry wins/battles)', () => {
    const rain = aggregateMatchup('r1', 'Rain One', archetype('Rain'), [battle(1), battle(1), battle(0)]);
    const rain2 = aggregateMatchup('r2', 'Rain Two', archetype('Rain'), [battle(null)]);
    const [card] = rollUpByArchetype([rain, rain2]);
    expect(cardRecord(card)).toEqual({wins: 1, losses: 2, draws: 1});
  });

  it('returns zeros for a card with no battles', () => {
    const empty = aggregateMatchup('e1', 'Empty', archetype(), []);
    const [card] = rollUpByArchetype([empty]);
    expect(cardRecord(card)).toEqual({wins: 0, losses: 0, draws: 0});
  });
});

describe('summarize verdict confidence', () => {
  /** n battles against one balanced opponent, `wins` of them won. */
  const run = (wins: number, n: number) => {
    const battles = Array.from({length: n}, (_, i) => battle(i < wins ? 0 : 1));
    const m = aggregateMatchup('b1', 'Bal', archetype(), battles);
    return summarize(rollUpByArchetype([m]), [m]);
  };

  it('will not name a band before the sample earns one', () => {
    // One win used to read "Strong overall, no glaring archetype hole" at
    // +/-40%, on the same team that settles at "Struggling".
    const one = run(1, 1);
    expect(one.provisional).toBe(true);
    expect(one.verdict).toMatch(/Still sampling/);
    expect(one.verdict).not.toMatch(/Strong overall|Solid|Struggling|Rough/);
    expect(run(MIN_VERDICT_BATTLES - 1, MIN_VERDICT_BATTLES - 1).provisional).toBe(true);
  });

  it('withholds the all-clear while provisional, since absence needs a sample', () => {
    expect(run(1, 1).verdict).not.toMatch(/no glaring archetype hole/);
  });

  it('names a band once the threshold is reached', () => {
    const settled = run(MIN_VERDICT_BATTLES, MIN_VERDICT_BATTLES);
    expect(settled.provisional).toBe(false);
    expect(settled.verdict).toMatch(/Strong overall/);
  });

  it('does not re-label on a single battle either side of a boundary', () => {
    // The observed failure: Solid -> Struggling -> Solid on adjacent battles
    // as the rate crossed 50%. Snapping to 5% steps holds the label still.
    const n = 40;
    const labels = new Set<string>();
    for (const wins of [19, 20, 21]) {
      labels.add(run(wins, n).verdict.split(',')[0]);
    }
    expect(labels.size).toBe(1);
  });
});
