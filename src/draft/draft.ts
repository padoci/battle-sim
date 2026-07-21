import type {PokemonSet, PoolEntry, SetsData} from '../data/types';
import {resolveMoveset, slashInfo, type SlashInfo} from '../data/resolve';
import {nextRng, offerWeight, sampleWithoutReplacement} from './sample';

/**
 * The draft engine (ui-spec §4b): 6 rounds; offers are usage-weighted
 * softened samples excluding already-drafted species (Species Clause).
 * Every mode deals 6 (species, set) bundles per round — the whole team is
 * pre-made sets, picked one card at a time. Pure functional state — same
 * seed + same picks = same offers. No reroll.
 *
 * Slash resolution: a bundle's set is resolved with the DEFAULT ('first')
 * strategy — the same canonical build @pkmn/smogon's own `Smogon.sets()`
 * would pick — so a card always shows exactly the moves/tera that will
 * battle, with no per-run variation beyond which cards get offered.
 */
export type DraftMode = 'gymleader' | 'easy' | 'hard';

export const OFFERS_PER_ROUND = 6;
export const TEAM_SIZE = 6;

export interface DraftOffer {
  species: string;
  usageWeighted: number;
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
  phase: 'drafting' | 'complete';
  offers: DraftOffer[];
  team: DraftPick[];
}

interface PoolData {
  pool: PoolEntry[];
  sets: SetsData;
}

function dealOffers(data: PoolData, state: Pick<DraftState, 'rngState' | 'team'>): {
  offers: DraftOffer[];
  rngState: number;
} {
  const drafted = new Set(state.team.map(pick => pick.species));
  const available = data.pool.filter(entry => !drafted.has(entry.species) && entry.setNames.length > 0);
  const {picked, state: rngState} = sampleWithoutReplacement(
    available,
    entry => offerWeight(entry.usageWeighted),
    OFFERS_PER_ROUND,
    state.rngState
  );

  // Each offer is a concrete bundle — set name chosen uniformly from the
  // species' named sets via the same rng stream.
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
  const base = {rngState: seed >>> 0, team: [] as DraftPick[]};
  const {offers, rngState} = dealOffers({pool, sets}, base);
  return {mode, rngState, round: 1, phase: 'drafting', offers, team: []};
}

function advance(state: DraftState, data: PoolData, pick: DraftPick): DraftState {
  const team = [...state.team, pick];
  if (team.length >= TEAM_SIZE) {
    return {...state, team, phase: 'complete', offers: [], round: TEAM_SIZE + 1};
  }
  const {offers, rngState} = dealOffers(data, {...state, team});
  return {...state, team, rngState, round: state.round + 1, phase: 'drafting', offers};
}

/** Pick a whole bundle: species + its concrete set. */
export function pickBundle(state: DraftState, pool: PoolEntry[], sets: SetsData, offerIndex: number): DraftState {
  if (state.phase !== 'drafting') throw new Error('not picking a bundle');
  const offer = state.offers[offerIndex];
  if (!offer) throw new Error(`invalid bundle index: ${offerIndex}`);
  return advance(state, {pool, sets}, {species: offer.species, setName: offer.setName, set: offer.set});
}
