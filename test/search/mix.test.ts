import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {gen9} from '../../src/data/gen';
import {teamMemberToSet} from '../../src/data/team';
import type {Team} from '../../src/data/types';
import {seedFromInts} from '../../src/engine/rng';
import {FAST} from '../../src/search/config';
import {runBattle, type BattleJob, type Policy} from '../../src/search/runner';

const gen = gen9();
const teams = (JSON.parse(readFileSync('test/fixtures/gen9ou.teams.full.json', 'utf8')) as Team[]).map(t =>
  t.data.map(teamMemberToSet)
);

const job = (policies: [Policy, Policy], i: number): BattleJob => ({
  teams: [teams[0], teams[1]],
  battleSeed: seedFromInts(i + 1, i + 2, i + 3, i + 4),
  searchSeed: 4200 + i,
  policies,
  maxTurns: 200,
});

describe('mix policy', () => {
  it('epsilon 0 is bit-for-bit identical to plain search (no RNG consumed)', () => {
    const search = runBattle(gen, job([{kind: 'search', config: FAST}, {kind: 'random'}], 0));
    const mix0 = runBattle(gen, job([{kind: 'mix', epsilon: 0, config: FAST}, {kind: 'random'}], 0));
    expect(mix0.winner).toBe(search.winner);
    expect(mix0.turns).toBe(search.turns);
    expect(mix0.decisions).toBe(search.decisions);
  });

  it('epsilon 1 (always blunders) is much weaker than full search', () => {
    // A mostly-blundering player should lose the majority to a real searcher.
    let searchWins = 0;
    const N = 8;
    for (let i = 0; i < N; i++) {
      // Alternate sides so neither p1/p2 tie-break bias decides it.
      const policies: [Policy, Policy] =
        i % 2 === 0
          ? [{kind: 'search', config: FAST}, {kind: 'mix', epsilon: 1, config: FAST}]
          : [{kind: 'mix', epsilon: 1, config: FAST}, {kind: 'search', config: FAST}];
      const result = runBattle(gen, job(policies, 100 + i));
      if (result.winner === (i % 2 === 0 ? 0 : 1)) searchWins++;
    }
    expect(searchWins).toBeGreaterThanOrEqual(6); // >= 75% to the real searcher
  });
});
