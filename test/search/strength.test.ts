import {describe, expect, it} from 'vitest';
import {gen9} from '../../src/data/gen';
import {seedFromInts} from '../../src/engine/rng';
import {FAST} from '../../src/search/config';
import {runBattle, type BattleJob, type Policy} from '../../src/search/runner';
import {fixtureTeams} from '../engine/helpers';

const gen = gen9();
const [team1, team2] = fixtureTeams();
const SEARCH: Policy = {kind: 'search', config: FAST};
const RANDOM: Policy = {kind: 'random'};

function play(
  teams: [typeof team1, typeof team2],
  policies: [Policy, Policy],
  seed: number
): 0 | 1 | null {
  const job: BattleJob = {
    teams,
    battleSeed: seedFromInts(seed, seed + 1, seed + 2, seed + 3),
    searchSeed: seed * 31,
    policies,
    maxTurns: 200,
  };
  return runBattle(gen, job).winner;
}

describe('strength (CI-safe seeded bounds; full numbers live in scripts/measure.ts)', () => {
  it('FAST search crushes a random-action baseline (>=80% of 20)', {timeout: 600_000}, () => {
    let wins = 0;
    for (let s = 1; s <= 10; s++) {
      if (play([team1, team2], [SEARCH, RANDOM], s) === 0) wins++;
      if (play([team1, team2], [RANDOM, SEARCH], 100 + s) === 1) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(16);
  });

  it('self-play is roughly side-balanced under team swap', {timeout: 600_000}, () => {
    // 10 seed-pairs; team1 plays as P1 then as P2. Count team1 wins per side.
    let team1WinsAsP1 = 0;
    let team1WinsAsP2 = 0;
    let decided = 0;
    for (let s = 1; s <= 10; s++) {
      const asP1 = play([team1, team2], [SEARCH, SEARCH], 1000 + s);
      const asP2 = play([team2, team1], [SEARCH, SEARCH], 1000 + s);
      if (asP1 !== null) {
        decided++;
        if (asP1 === 0) team1WinsAsP1++;
      }
      if (asP2 !== null) {
        decided++;
        if (asP2 === 1) team1WinsAsP2++;
      }
    }
    expect(decided).toBeGreaterThanOrEqual(16); // not everything draws out
    // Statistical bound, pinned by seeds: no gross side bias.
    expect(Math.abs(team1WinsAsP1 - team1WinsAsP2)).toBeLessThanOrEqual(4);
  });
});
