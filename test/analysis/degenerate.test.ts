import {describe, expect, it} from 'vitest';
import {gen9} from '../../src/data/gen';
import {aggregateMatchup, cardRecord, rollUpByArchetype, summarize, type MatchupAggregate, type RecordedBattle} from '../../src/analysis/stats';
import {classifyTeam, extractFeatures, teamDisplayName, type ArchetypeResult} from '../../src/analysis/archetype';
import {buildPostMortem, type PlayedBattle} from '../../src/analysis/postmortem';
import {findBiggestHit} from '../../src/analysis/highlights';
import {wilsonHalfWidth} from '../../src/analysis/confidence';
import {rankSuggestions, statSuggestions} from '../../src/analysis/suggestions';
import {buildExportJson, buildExportMarkdown, type ExportInputs} from '../../src/analysis/export';
import type {BattleResult} from '../../src/search/runner';
import type {BattleStats} from '../../src/search/stats';
import {fixtureTeams} from '../engine/helpers';

/**
 * The analysis layer IS the "Test your team" product, and every existing test
 * feeds it well-formed battles. This feeds it the shapes that show up at the
 * edges of a real session instead: nothing run yet, exactly one battle, every
 * game a draw, a battle where nobody fainted, and — the one that actually
 * happens — `winner: null` from the decision cap in runner.ts.
 *
 * The contract asserted is deliberately shallow and total: **never throw, and
 * never render NaN or undefined into text a user reads.** Those are the two
 * failure modes that turn a dashboard into a bug report.
 */

const gen = gen9();
const [userTeam, oppTeam] = fixtureTeams();

function result(winner: 0 | 1 | null, stats: Partial<BattleStats> = {}): BattleResult {
  return {
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
}

const archetype = (): ArchetypeResult => classifyTeam(gen, oppTeam);

const recorded = (winners: Array<0 | 1 | null>): RecordedBattle[] =>
  winners.map(w => ({teamId: 't1', result: result(w)}));

/** Every user-visible string an aggregate/card/summary can produce. */
function textOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) textOf(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) textOf(v, out);
  return out;
}

function expectCleanText(value: unknown, what: string) {
  for (const text of textOf(value)) {
    expect(text, `${what} rendered: ${JSON.stringify(text)}`).not.toMatch(/\bNaN\b|\bundefined\b|\bnull\b/);
  }
}

/** Every number an aggregate can produce must be finite. */
function expectFiniteNumbers(value: unknown, what: string, path = '') {
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `${what}${path} = ${value}`).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => expectFiniteNumbers(v, what, `${path}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) expectFiniteNumbers(v, what, `${path}.${k}`);
  }
}

const CASES: Array<{name: string; battles: RecordedBattle[]}> = [
  {name: 'no battles at all', battles: []},
  {name: 'a single win', battles: recorded([0])},
  {name: 'a single loss', battles: recorded([1])},
  {name: 'every game a draw', battles: recorded([null, null, null])},
  {name: 'every game a win', battles: recorded([0, 0, 0, 0])},
  {name: 'every game a loss', battles: recorded([1, 1, 1, 1])},
  {name: 'a capped/stalled battle mixed in', battles: recorded([0, null, 1])},
];

describe('aggregateMatchup on degenerate battle sets', () => {
  for (const {name, battles} of CASES) {
    it(`survives ${name}`, () => {
      const agg = aggregateMatchup('t1', 'Test Team', archetype(), battles);
      expectFiniteNumbers(agg, `aggregate for ${name}`);
      expectCleanText({teamName: agg.teamName}, `aggregate for ${name}`);
      expect(agg.battles).toBe(battles.length);
      expect(agg.wins + agg.losses + agg.draws).toBe(battles.length);
      expect(agg.winRate).toBeGreaterThanOrEqual(0);
      expect(agg.winRate).toBeLessThanOrEqual(1);
    });
  }

  it('counts a capped battle as a draw, not a phantom win or loss', () => {
    // runner.ts returns winner: null when a battle hits the decision cap.
    const agg = aggregateMatchup('t1', 'Test Team', archetype(), recorded([null, null]));
    expect(agg.wins).toBe(0);
    expect(agg.losses).toBe(0);
    expect(agg.draws).toBe(2);
    expect(agg.winRate).toBe(0);
  });

  it('reports a zero win rate rather than NaN when there are no battles', () => {
    const agg = aggregateMatchup('t1', 'Test Team', archetype(), []);
    expect(agg.winRate).toBe(0);
    expect(agg.speedRaceWinRate).not.toBeNaN();
  });

  it('does not divide by zero when nobody ever fainted or dealt damage', () => {
    const agg = aggregateMatchup('t1', 'Test Team', archetype(), recorded([0, 1]));
    expect(agg.earliestFaints).toEqual([]);
    expect(agg.mostWork).toEqual([]);
    expectFiniteNumbers(agg, 'no-action aggregate');
  });
});

describe('rollUpByArchetype / summarize on degenerate inputs', () => {
  it('summarises an empty dashboard without NaN or a broken verdict', () => {
    const cards = rollUpByArchetype([]);
    expect(cards).toEqual([]);
    const summary = summarize(cards, []);
    expect(summary.battles).toBe(0);
    expect(summary.winRate).toBe(0);
    expectFiniteNumbers(summary, 'empty summary');
    expectCleanText(summary.verdict, 'empty summary verdict');
  });

  for (const {name, battles} of CASES) {
    it(`summarises ${name} cleanly`, () => {
      const agg = aggregateMatchup('t1', 'Test Team', archetype(), battles);
      const cards = rollUpByArchetype([agg]);
      const summary = summarize(cards, [agg]);
      expectFiniteNumbers(summary, `summary for ${name}`);
      expectCleanText(summary.verdict, `summary verdict for ${name}`);
      for (const card of cards) {
        expectFiniteNumbers(card.winRate, `card winRate for ${name}`);
        const record = cardRecord(card);
        expect(record.wins + record.losses + record.draws).toBe(battles.length);
      }
    });
  }

  it('handles a matchup list where every entry has zero battles', () => {
    const empty: MatchupAggregate = aggregateMatchup('t1', 'Empty', archetype(), []);
    const summary = summarize(rollUpByArchetype([empty, empty]), [empty, empty]);
    expect(summary.battles).toBe(0);
    expectCleanText(summary.verdict, 'all-empty summary');
  });
});

describe('confidence on degenerate sample sizes', () => {
  it('returns a finite half-width at n = 0, 1, and extreme rates', () => {
    for (const [p, n] of [[0, 0], [0, 1], [1, 1], [0.5, 1], [0, 1000], [1, 1000]] as const) {
      const half = wilsonHalfWidth(p, n);
      expect(Number.isFinite(half), `wilson(${p}, ${n}) = ${half}`).toBe(true);
      expect(half).toBeGreaterThanOrEqual(0);
      expect(half).toBeLessThanOrEqual(1);
    }
  });
});

describe('postmortem on degenerate runs', () => {
  const opponents = Array.from({length: 6}, (_, i) => ({name: `Opponent ${i + 1}`, sets: oppTeam}));
  const played = (winners: Array<0 | 1 | null>): PlayedBattle[] =>
    winners.map((w, i) => ({opponentIndex: i, result: result(w)}));

  it('describes an elimination in game 1', () => {
    const pm = buildPostMortem(gen, userTeam, opponents, played([1]), 'eliminated');
    expect(pm.record).toBe('0–1');
    expectCleanText(pm, 'game-1 elimination');
  });

  it('describes a run that STALLED out rather than lost', () => {
    // The capped-battle path: winner null, so "Stalled out" not "Eliminated".
    const pm = buildPostMortem(gen, userTeam, opponents, played([0, 0, null]), 'eliminated');
    expect(pm.headline).toMatch(/Stalled out/);
    expectCleanText(pm, 'stalled run');
  });

  it('describes a flawless run', () => {
    const pm = buildPostMortem(gen, userTeam, opponents, played([0, 0, 0, 0, 0, 0]), 'flawless');
    expect(pm.record).toBe('6–0');
    expectCleanText(pm, 'flawless run');
  });
});

describe('highlights on degenerate logs', () => {
  it('returns undefined rather than throwing on an empty or noise-only log', () => {
    expect(findBiggestHit([])).toBeUndefined();
    expect(findBiggestHit(['|turn|1', '|upkeep'])).toBeUndefined();
  });

  it('does not throw on a log full of malformed lines', () => {
    expect(() =>
      findBiggestHit([
        '|-damage|p1a: X',
        '|move|p2a: Y',
        '|-damage|',
        '|faint|',
        'not a protocol line at all',
      ])
    ).not.toThrow();
  });
});

describe('archetype + suggestions on edge-case teams', () => {
  it('classifies a full team and names it without leaking undefined', () => {
    const classified = classifyTeam(gen, userTeam);
    expect(classified.label).toBeTruthy();
    expectCleanText(classified.label, 'archetype label');
    expectCleanText(teamDisplayName(gen, userTeam), 'team display name');
  });

  it('extracts features from a one-Pokemon team without dividing by zero', () => {
    const features = extractFeatures(gen, userTeam.slice(0, 1));
    expectFiniteNumbers(features, 'one-mon features');
  });

  it('produces no suggestions, rather than broken ones, from a zero-battle card', () => {
    const agg = aggregateMatchup('t1', 'Empty', archetype(), []);
    const [card] = rollUpByArchetype([agg]);
    const suggestions = rankSuggestions(statSuggestions(card, userTeam));
    expectCleanText(suggestions, 'zero-battle suggestions');
  });
});

describe('export on a degenerate dashboard', () => {
  const emptyInputs = (): ExportInputs => ({
    teamRaw: '',
    teamWire: [],
    n: 0,
    calibrationBattles: 0,
    cancelled: false,
    overall: summarize([], []),
    cards: [],
    poolMeta: [],
    now: () => new Date(0),
  });

  it('builds JSON and markdown for a session with no battles', () => {
    const json = buildExportJson(emptyInputs());
    expectFiniteNumbers(json, 'empty export json');
    const markdown = buildExportMarkdown(json);
    expect(typeof markdown).toBe('string');
    expect(markdown).not.toMatch(/\bNaN\b|\bundefined\b/);
  });

  it('builds an export for a run that was cancelled after one drawn battle', () => {
    const agg = aggregateMatchup('t1', 'Test Team', archetype(), recorded([null]));
    const cards = rollUpByArchetype([agg]);
    const json = buildExportJson({
      ...emptyInputs(),
      n: 1,
      calibrationBattles: 1,
      cancelled: true,
      overall: summarize(cards, [agg]),
      cards,
      poolMeta: [{teamId: 't1', teamName: 'Test Team', weight: 1}],
    });
    expectFiniteNumbers(json, 'cancelled export json');
    expect(buildExportMarkdown(json)).not.toMatch(/\bNaN\b|\bundefined\b/);
  });
});
