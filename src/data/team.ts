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

/**
 * Collapse a concrete `PokemonSet` (e.g. from `Teams.import`) back to the
 * sparse `/teams` wire shape, so externally-sourced teams flow through the
 * same `teamMemberToSet` path as the built-in pool. Inverse enough of
 * `teamMemberToSet`: the round-trip re-normalizes defaults identically.
 */
export function setToTeamMember(set: PokemonSet): TeamMemberWire {
  return {
    species: set.species,
    ...(set.item ? {item: set.item} : {}),
    ability: set.ability,
    ...(set.teraType ? {teraType: set.teraType} : {}),
    ...(set.nature ? {nature: set.nature} : {}),
    ...(set.gender ? {gender: set.gender} : {}),
    ...(set.level ? {level: set.level} : {}),
    ...(set.evs ? {evs: set.evs} : {}),
    ...(set.ivs ? {ivs: set.ivs} : {}),
    moves: [...set.moves],
  };
}
