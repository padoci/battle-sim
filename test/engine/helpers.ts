import {teamMemberToSet} from '../../src/data/team';
import type {PokemonSet, Team} from '../../src/data/types';
import teamsFixture from '../fixtures/teams.fixture.json';

/** The two vendored real gen9ou teams as concrete sets. */
export function fixtureTeams(): [PokemonSet[], PokemonSet[]] {
  const teams = teamsFixture as Team[];
  return [teams[0].data.map(teamMemberToSet), teams[1].data.map(teamMemberToSet)];
}

/** Hand-built set with sane defaults, for scripted battles. */
export function makeSet(
  species: string,
  moves: string[],
  options: Partial<PokemonSet> = {}
): PokemonSet {
  return {
    name: species,
    species,
    item: '',
    ability: '',
    moves,
    nature: 'Serious',
    gender: '',
    evs: {hp: 252, atk: 252, def: 4, spa: 252, spd: 4, spe: 252},
    ivs: {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31},
    level: 100,
    ...options,
  };
}
