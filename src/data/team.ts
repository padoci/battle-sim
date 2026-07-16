import type {PokemonSet, StatsTable, TeamMemberWire} from './types';

const EMPTY_EVS: StatsTable = {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0};
const FULL_IVS: StatsTable = {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31};

/**
 * Normalize a sparse `/teams` wire entry into a full `PokemonSet`
 * (defaults: level 100, evs 0, ivs 31, name = species).
 */
export function teamMemberToSet(member: TeamMemberWire): PokemonSet {
  return {
    name: member.species,
    species: member.species,
    item: member.item ?? '',
    ability: member.ability,
    moves: [...member.moves],
    nature: member.nature ?? 'Serious',
    gender: member.gender ?? '',
    evs: {...EMPTY_EVS, ...member.evs},
    ivs: {...FULL_IVS, ...member.ivs},
    level: member.level ?? 100,
    ...(member.teraType ? {teraType: member.teraType} : {}),
  };
}
