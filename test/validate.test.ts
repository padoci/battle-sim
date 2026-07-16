import {describe, expect, it} from 'vitest';
import {TeamValidator} from '@pkmn/sim';
import {resolveMoveset} from '../src/data/resolve';
import {teamMemberToSet} from '../src/data/team';
import type {SetsData, Team} from '../src/data/types';
import fullSets from './fixtures/gen9ou.sets.full.json';
import fullTeams from './fixtures/gen9ou.teams.full.json';

const sets = fullSets as SetsData;
const teams = fullTeams as Team[];

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('every resolved gen9ou set is sim-legal', () => {
  const validator = new TeamValidator('gen9ou');

  it("under the 'first' strategy", () => {
    for (const [species, byName] of Object.entries(sets)) {
      for (const [setName, moveset] of Object.entries(byName)) {
        const set = resolveMoveset(species, moveset);
        const problems = validator.validateTeam([set]);
        expect(problems, `${species} [${setName}] -> ${problems?.join('; ')}`).toBeNull();
      }
    }
  });

  it("under the 'sample' strategy (3 seeds per set)", () => {
    for (const [species, byName] of Object.entries(sets)) {
      for (const [setName, moveset] of Object.entries(byName)) {
        for (let seed = 1; seed <= 3; seed++) {
          const set = resolveMoveset(species, moveset, {
            strategy: 'sample',
            rng: seededRng(seed * 7919),
          });
          const problems = validator.validateTeam([set]);
          expect(problems, `${species} [${setName}] seed ${seed} -> ${problems?.join('; ')}`).toBeNull();
        }
      }
    }
  });
});

describe('every upstream team is structurally sound', () => {
  it('validates all /teams entries as full teams, tolerating tier drift', () => {
    // The teams file tracks the live metagame while @pkmn/sim's banlist is a
    // snapshot, so pure tiering complaints (e.g. a newly-banned species) are
    // expected; anything else (bad ability/move/item, EV overflow, ...) would
    // mean our normalization is wrong.
    const validator = new TeamValidator('gen9ou');
    for (const [i, team] of teams.entries()) {
      const full = team.data.map(teamMemberToSet);
      const problems = validator.validateTeam(full) ?? [];
      const structural = problems.filter(p => !/\bbanned\b/i.test(p));
      expect(structural, `team #${i} (${team.name ?? 'unnamed'}) -> ${structural.join('; ')}`).toEqual(
        []
      );
    }
  });
});
