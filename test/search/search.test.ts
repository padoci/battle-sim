import {describe, expect, it} from 'vitest';
import {gen9} from '../../src/data/gen';
import {seedFromInts} from '../../src/engine/rng';
import {FAST, STRONG} from '../../src/search/config';
import {saddleMidpoint} from '../../src/search/search';
import {runBattle, type BattleJob} from '../../src/search/runner';
import {fixtureTeams} from '../engine/helpers';

const gen = gen9();
const [team1, team2] = fixtureTeams();

function job(overrides: Partial<BattleJob> = {}): BattleJob {
  return {
    teams: [team1, team2],
    battleSeed: seedFromInts(10, 20, 30, 40),
    searchSeed: 777,
    policies: [
      {kind: 'search', config: FAST},
      {kind: 'search', config: FAST},
    ],
    ...overrides,
  };
}

describe('saddleMidpoint', () => {
  it('equals the game value when a saddle exists', () => {
    // Saddle at row 1 / col 0, value 2.
    expect(
      saddleMidpoint([
        [1, 0, 3],
        [2, 5, 4],
      ])
    ).toBe(2);
  });

  it('is exactly antisymmetric under pov swap', () => {
    const matrix = [
      [3, -1, 4],
      [0, 2, -5],
    ];
    // Swap pov: negate and transpose.
    const swapped = matrix[0].map((_, j) => matrix.map(row => -row[j]));
    expect(saddleMidpoint(matrix)).toBeCloseTo(-saddleMidpoint(swapped), 10);
  });

  it('brackets between maxmin and minmax on a mixed game', () => {
    const matrix = [
      [1, -1],
      [-1, 1],
    ];
    expect(saddleMidpoint(matrix)).toBe(0); // maxmin -1, minmax 1
  });
});

describe('runBattle (FAST self-play)', () => {
  it('completes with a winner and sane stats', () => {
    const result = runBattle(gen, job());
    expect([0, 1]).toContain(result.winner);
    expect(result.turns).toBeGreaterThan(3);
    expect(result.nodes).toBeGreaterThan(50);
    expect(result.msPerDecision.mean).toBeGreaterThan(0);
  });

  it('is fully deterministic given the same seeds', () => {
    // The protocol log embeds wall-clock '|t:|' lines — strip those.
    const strip = (log: string[]) => log.filter(l => !l.startsWith('|t:|'));
    const a = runBattle(gen, job({collectLog: true}));
    const b = runBattle(gen, job({collectLog: true}));
    expect(a.winner).toBe(b.winner);
    expect(a.turns).toBe(b.turns);
    expect(a.nodes).toBe(b.nodes);
    expect(strip(a.protocolLog!)).toEqual(strip(b.protocolLog!));
  });

  it('different search seeds can diverge', () => {
    const strip = (log: string[]) => log.filter(l => !l.startsWith('|t:|'));
    const a = runBattle(gen, job({collectLog: true}));
    const b = runBattle(gen, job({collectLog: true, searchSeed: 778}));
    // Not guaranteed for every pair, but these seeds diverge (pinned).
    expect(strip(a.protocolLog!).join()).not.toBe(strip(b.protocolLog!).join());
  });

  it('trace probabilities are a distribution and chosen actions are in support', () => {
    const result = runBattle(gen, job({collectTrace: true}));
    expect(result.trace!.length).toBeGreaterThan(0);
    for (const trace of result.trace!) {
      const sum = (d: number[]) => d.reduce((a, b) => a + b, 0);
      expect(sum(trace.solution.row)).toBeCloseTo(1, 5);
      expect(sum(trace.solution.col)).toBeCloseTo(1, 5);
      expect(trace.solution.row[trace.chosen[0]]).toBeGreaterThan(0);
      expect(trace.solution.col[trace.chosen[1]]).toBeGreaterThan(0);
      expect(trace.matrix.length).toBe(trace.actions[0].length);
      expect(trace.matrix[0].length).toBe(trace.actions[1].length);
      expect(trace.labels[0].length).toBe(trace.actions[0].length);
    }
  });
});

describe('runBattle (STRONG / d2)', () => {
  it('completes a d2 self-play battle deterministically', () => {
    const d2Job = job({
      policies: [
        {kind: 'search', config: STRONG},
        {kind: 'search', config: STRONG},
      ],
      maxTurns: 60, // keep CI time bounded; draws are fine here
    });
    const a = runBattle(gen, d2Job);
    const b = runBattle(gen, d2Job);
    expect(a.turns).toBe(b.turns);
    expect(a.nodes).toBe(b.nodes);
    expect(a.nodesPerDecision).toBeGreaterThan(30); // interior actually expanded
  });
});
