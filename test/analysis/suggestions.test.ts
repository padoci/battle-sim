import {describe, expect, it} from 'vitest';
import {gen9} from '../../src/data/gen';
import {buildCalcTable} from '../../src/engine/calc/table';
import {buildPairingContext} from '../../src/analysis/threats';
import {
  calcSuggestions,
  rankSuggestions,
  statSuggestions,
  type Suggestion,
} from '../../src/analysis/suggestions';
import type {ArchetypeCard, MatchupAggregate} from '../../src/analysis/stats';
import type {ArchetypeResult} from '../../src/analysis/archetype';
import {makeSet} from '../engine/helpers';

const gen = gen9();

const archetype: ArchetypeResult = {
  primary: 'balance',
  label: 'Balance',
  features: {offensiveCount: 2, defensiveCount: 2, offensiveMons: [], defensiveMons: []},
};

/** Synthetic MatchupAggregate with quiet defaults; override per heuristic. */
function matchup(overrides: Partial<MatchupAggregate> = {}): MatchupAggregate {
  return {
    teamId: 't1',
    teamName: 'Opponent',
    archetype,
    battles: 20,
    wins: 10,
    losses: 10,
    draws: 0,
    winRate: 0.5,
    earliestFaints: [],
    mostWork: [],
    speedRaceWinRate: 0.5,
    raceDecisions: 0,
    carriedBy: [],
    dealtBy: [],
    kosScored: [],
    ...overrides,
  };
}

function card(matchups: MatchupAggregate[], overrides: Partial<ArchetypeCard> = {}): ArchetypeCard {
  const battles = matchups.reduce((s, m) => s + m.battles, 0);
  const wins = matchups.reduce((s, m) => s + m.wins, 0);
  return {
    archetype: 'balance',
    label: 'Balance',
    battles,
    wins,
    winRate: battles ? wins / battles : 0,
    distinctOpponents: matchups.length,
    matchups,
    threats: [],
    ...overrides,
  };
}

const team = [makeSet('Gliscor', ['Earthquake']), makeSet('Kingambit', ['Kowtow Cleave'])];

const byKind = (list: Suggestion[], kind: Suggestion['kind']) => list.filter(s => s.kind === kind);

describe('statSuggestions', () => {
  it('hazard-chip fires at >=30% chip faints with >=3 faints, silent just below', () => {
    const fires = statSuggestions(
      card([matchup({earliestFaints: [{speciesId: 'gliscor', faintCount: 10, meanTurn: 9, chipFaints: 3}]})]),
      team
    );
    expect(byKind(fires, 'hazard-chip')).toHaveLength(1);
    expect(byKind(fires, 'hazard-chip')[0].sentence).toMatch(/Boots|removal/);

    const below = statSuggestions(
      card([matchup({earliestFaints: [{speciesId: 'gliscor', faintCount: 10, meanTurn: 9, chipFaints: 2}]})]),
      team
    );
    expect(byKind(below, 'hazard-chip')).toHaveLength(0);
  });

  it('dead-weight fires on early frequent faints + no damage, silent when it deals damage', () => {
    const faints = {speciesId: 'gliscor', faintCount: 13, meanTurn: 5, chipFaints: 0};
    const fires = statSuggestions(
      card([matchup({earliestFaints: [faints], dealtBy: [{speciesId: 'gliscor', totalDamageFrac: 0.4}]})]),
      team
    );
    expect(byKind(fires, 'dead-weight')).toHaveLength(1);

    const contributes = statSuggestions(
      card([matchup({earliestFaints: [faints], dealtBy: [{speciesId: 'gliscor', totalDamageFrac: 3.5}]})]),
      team
    );
    expect(byKind(contributes, 'dead-weight')).toHaveLength(0);
  });

  it('speed-losing fires below 40% over >=20 races, silent on a small sample', () => {
    const fires = statSuggestions(
      card([matchup({speedRaceWinRate: 0.3, raceDecisions: 40})]),
      team
    );
    expect(byKind(fires, 'speed-losing')).toHaveLength(1);

    const smallSample = statSuggestions(
      card([matchup({speedRaceWinRate: 0.3, raceDecisions: 10})]),
      team
    );
    expect(byKind(smallSample, 'speed-losing')).toHaveLength(0);
  });

  it('overreliance fires when one mon carries >=40% of winning damage and winRate < 0.65', () => {
    const carried = [
      {speciesId: 'kingambit', damageFracInWins: 5},
      {speciesId: 'gliscor', damageFracInWins: 2},
      {speciesId: 'dragapult', damageFracInWins: 1},
    ];
    const fires = statSuggestions(card([matchup({carriedBy: carried})]), team);
    expect(byKind(fires, 'overreliance')).toHaveLength(1);
    expect(byKind(fires, 'overreliance')[0].targetSpeciesId).toBe('kingambit');

    // High win rate → no complaint even with the same skew.
    const winning = statSuggestions(
      card([matchup({carriedBy: carried, wins: 16, losses: 4, winRate: 0.8})]),
      team
    );
    expect(byKind(winning, 'overreliance')).toHaveLength(0);
  });

  it('ko-drought fires only when KO data exists and a slot scored none', () => {
    const fires = statSuggestions(
      card([matchup({kosScored: [{speciesId: 'kingambit', count: 12}]})]),
      team
    );
    const drought = byKind(fires, 'ko-drought');
    expect(drought).toHaveLength(1);
    expect(drought[0].targetSpeciesId).toBe('gliscor');

    // No KO data at all (stats not collected) → never flags the whole team.
    const noData = statSuggestions(card([matchup({})]), team);
    expect(byKind(noData, 'ko-drought')).toHaveLength(0);
  });

  it('is silent on an empty card', () => {
    expect(statSuggestions(card([]), team)).toEqual([]);
  });
});

describe('calcSuggestions (fixture calc)', () => {
  // Darkrai vs three 4x-ice-weak mons: Ice Beam threatens the whole team and
  // nothing switches in — both calc heuristics should fire.
  const frailTeam = [
    makeSet('Gliscor', ['Protect', 'Toxic'], {nature: 'Impish'}),
    makeSet('Landorus-Therian', ['U-turn'], {nature: 'Jolly'}),
    makeSet('Garchomp', ['Protect'], {nature: 'Jolly'}),
  ];
  const darkrai = [
    makeSet('Darkrai', ['Dark Pulse', 'Ice Beam', 'Focus Blast', 'Sludge Bomb'], {
      nature: 'Timid',
      evs: {hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252},
    }),
  ];
  const table = buildCalcTable(gen, [frailTeam, darkrai]);
  const ctx = buildPairingContext(gen, frailTeam, darkrai, table);
  const worst = matchup({mostWork: [{speciesId: 'darkrai', totalDamageFrac: 9}]});

  it('unchecked-sweeper fires when a mon 2HKOs at least three of yours', () => {
    const out = calcSuggestions(ctx, worst);
    const sweeper = byKind(out, 'unchecked-sweeper');
    expect(sweeper).toHaveLength(1);
    expect(sweeper[0].sentence).toMatch(/Darkrai/);
    expect(sweeper[0].evidence.length).toBeGreaterThanOrEqual(3);
  });

  it('no-answer fires when the best switch-in still loses the 1v1', () => {
    const out = calcSuggestions(ctx, worst);
    const noAnswer = byKind(out, 'no-answer');
    expect(noAnswer).toHaveLength(1);
    expect(noAnswer[0].sentence).toMatch(/no reliable answer to Darkrai/);
  });

  it('is silent when the workhorse is not on the field', () => {
    expect(calcSuggestions(ctx, matchup({mostWork: []}))).toEqual([]);
  });
});

describe('rankSuggestions', () => {
  const s = (kind: Suggestion['kind'], severity: Suggestion['severity'], target?: string): Suggestion => ({
    kind,
    severity,
    sentence: kind,
    evidence: [],
    targetSpeciesId: target,
  });

  it('sorts by severity, dedupes (kind,target), and caps', () => {
    const ranked = rankSuggestions(
      [
        s('ko-drought', 'low', 'a'),
        s('speed-losing', 'medium'),
        s('dead-weight', 'high', 'a'),
        s('dead-weight', 'high', 'a'), // duplicate → dropped
        s('dead-weight', 'high', 'b'), // different target → kept
        s('hazard-chip', 'high', 'c'),
        s('overreliance', 'medium', 'd'),
      ],
      4
    );
    expect(ranked).toHaveLength(4);
    expect(ranked.every((x, i) => i === 0 || x.severity !== 'high' || ranked[i - 1].severity === 'high')).toBe(true);
    expect(ranked.filter(x => x.kind === 'dead-weight')).toHaveLength(2);
    expect(ranked[0].severity).toBe('high');
  });
});
