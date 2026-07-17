import type {Moveset, PokemonSet, PoolEntry, SetsData} from '../data/types';
import {resolveMoveset, slashInfo, type SlashInfo} from '../data/resolve';
import {nextRng, offerWeight, sampleWithoutReplacement} from './sample';

/**
 * The draft engine (ui-spec §4b): 6 rounds; offers are usage-weighted
 * softened samples excluding already-drafted species (Species Clause).
 * `easy`/`normal` pick a species then its set (10 options, more curation);
 * `hard` picks (species, set) bundles (6 options, less help). `easy` and
 * `normal` share the draft flow — they differ only in gauntlet difficulty
 * (easy ramps the opponent AI up over the six battles).
 * Pure functional state — same seed + same picks = same offers. No reroll.
 *
 * Slash resolution is 'first' everywhere: what the picker displays is
 * exactly what battles (matches @pkmn/smogon's own resolution).
 */
export type DraftMode = 'easy' | 'normal' | 'hard';

/** `hard` is the only bundle mode; easy/normal share the two-stage flow. */
export const OFFERS_PER_ROUND: Record<DraftMode, number> = {easy: 10, normal: 10, hard: 6};
export const TEAM_SIZE = 6;

export interface DraftOffer {
  species: string;
  usageWeighted: number;
  /** Hard-mode bundles carry the concrete set. */
  setName?: string;
  set?: PokemonSet;
  slashes?: SlashInfo;
}

export interface SetOption {
  setName: string;
  set: PokemonSet;
  slashes: SlashInfo;
}

export interface DraftPick {
  species: string;
  setName: string;
  set: PokemonSet;
}

export interface DraftState {
  mode: DraftMode;
  rngState: number;
  /** 1-based round; rounds > TEAM_SIZE mean the draft is complete. */
  round: number;
  phase: 'species' | 'set' | 'complete';
  offers: DraftOffer[];
  /** Two-stage (easy/normal) stage 2: the chosen species' named dex sets. */
  setOptions?: SetOption[];
  team: DraftPick[];
}

interface PoolData {
  pool: PoolEntry[];
  sets: SetsData;
}

function dealOffers(data: PoolData, state: Pick<DraftState, 'mode' | 'rngState' | 'team'>): {
  offers: DraftOffer[];
  rngState: number;
} {
  const drafted = new Set(state.team.map(pick => pick.species));
  const available = data.pool.filter(entry => !drafted.has(entry.species) && entry.setNames.length > 0);
  const {picked, state: rngState} = sampleWithoutReplacement(
    available,
    entry => offerWeight(entry.usageWeighted),
    OFFERS_PER_ROUND[state.mode],
    state.rngState
  );

  if (state.mode !== 'hard') {
    // Easy/normal: species-only offers; the set is chosen in stage 2.
    return {
      offers: picked.map(entry => ({species: entry.species, usageWeighted: entry.usageWeighted})),
      rngState,
    };
  }

  // Hard: each offer is a concrete bundle — set name chosen uniformly
  // from the species' named sets via the same rng stream.
  let rng = rngState;
  const offers = picked.map(entry => {
    const step = nextRng(rng);
    rng = step.state;
    const setName = entry.setNames[Math.min(entry.setNames.length - 1, Math.floor(step.value * entry.setNames.length))];
    const moveset = data.sets[entry.species][setName];
    return {
      species: entry.species,
      usageWeighted: entry.usageWeighted,
      setName,
      set: resolveMoveset(entry.species, moveset),
      slashes: slashInfo(moveset),
    };
  });
  return {offers, rngState: rng};
}

export function createDraft(pool: PoolEntry[], sets: SetsData, mode: DraftMode, seed: number): DraftState {
  const base = {mode, rngState: seed >>> 0, team: [] as DraftPick[]};
  const {offers, rngState} = dealOffers({pool, sets}, base);
  return {mode, rngState, round: 1, phase: 'species', offers, team: []};
}

/** Two-stage (easy/normal) stage 1: choose a species; reveals its named sets. */
export function pickSpecies(state: DraftState, sets: SetsData, species: string): DraftState {
  if (state.mode === 'hard' || state.phase !== 'species') throw new Error('not picking species');
  if (!state.offers.some(offer => offer.species === species)) throw new Error(`not offered: ${species}`);
  const bySet = sets[species] ?? {};
  const setOptions = Object.entries(bySet).map(([setName, moveset]: [string, Moveset]) => ({
    setName,
    set: resolveMoveset(species, moveset),
    slashes: slashInfo(moveset),
  }));
  return {...state, phase: 'set', setOptions, offers: state.offers.filter(o => o.species === species)};
}

function advance(state: DraftState, data: PoolData, pick: DraftPick): DraftState {
  const team = [...state.team, pick];
  if (team.length >= TEAM_SIZE) {
    return {...state, team, phase: 'complete', offers: [], setOptions: undefined, round: TEAM_SIZE + 1};
  }
  const {offers, rngState} = dealOffers(data, {...state, team});
  return {
    ...state,
    team,
    rngState,
    round: state.round + 1,
    phase: 'species',
    offers,
    setOptions: undefined,
  };
}

/** Two-stage (easy/normal) stage 2: choose one of the revealed sets. */
export function pickSet(state: DraftState, pool: PoolEntry[], sets: SetsData, setName: string): DraftState {
  if (state.mode === 'hard' || state.phase !== 'set' || !state.setOptions) throw new Error('not picking a set');
  const option = state.setOptions.find(o => o.setName === setName);
  if (!option) throw new Error(`unknown set: ${setName}`);
  const species = state.offers[0].species;
  return advance(state, {pool, sets}, {species, setName, set: option.set});
}

/** Hard mode: pick a whole bundle. */
export function pickBundle(state: DraftState, pool: PoolEntry[], sets: SetsData, offerIndex: number): DraftState {
  if (state.mode !== 'hard' || state.phase !== 'species') throw new Error('not picking a bundle');
  const offer = state.offers[offerIndex];
  if (!offer?.set || !offer.setName) throw new Error(`invalid bundle index: ${offerIndex}`);
  return advance(state, {pool, sets}, {species: offer.species, setName: offer.setName, set: offer.set});
}
