import {defaultAbility} from './gen';
import type {Moveset, PokemonSet, StatsTable} from './types';

export type ResolveStrategy = 'first' | 'sample';

export interface ResolveOptions {
  /**
   * 'first' (default) deterministically takes the first alternative of every
   * slash — the same choice @pkmn/smogon's `Smogon.sets()` makes. 'sample'
   * picks uniformly among alternatives using `rng`.
   */
  strategy?: ResolveStrategy;
  /** Uniform [0,1) source for 'sample'; defaults to Math.random. */
  rng?: () => number;
}

/** Which fields of a moveset carry slash alternatives (for set-picker UIs). */
export interface SlashInfo {
  /** Move slots with more than one option, by slot index. */
  moveSlots: Array<{slot: number; options: string[]}>;
  ability?: string[];
  item?: string[];
  nature?: string[];
  teratypes?: string[];
  /** Number of alternative EV spreads (absent when there's just one). */
  evSpreads?: number;
}

const EMPTY_EVS: StatsTable = {hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0};
const FULL_IVS: StatsTable = {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31};

function alternatives<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function makeChooser(options: ResolveOptions | undefined): (n: number) => number {
  if (options?.strategy === 'sample') {
    const rng = options.rng ?? Math.random;
    return n => Math.min(n - 1, Math.floor(rng() * n));
  }
  return () => 0;
}

/**
 * Resolve a slashed wire-format moveset into a concrete, sim-legal
 * `PokemonSet`.
 *
 * Slash semantics (measured against the real gen9ou payload):
 * - Move slots are resolved in order, and a slot never repeats a move chosen
 *   by an earlier slot (alternatives can collide across slots — e.g.
 *   Kingambit lists Low Kick in two different slots).
 * - `nature` and `evs` alternatives of equal length are index-paired (they
 *   render as paired on Smogon analyses); unequal lengths are independent.
 * - Missing evs default to 0, missing ivs to 31, level to 100.
 * - `name` is the species, not the set label: real set names ("Dragon Dance
 *   + Scale Shot") overflow the sim's 18-char nickname limit.
 */
export function resolveMoveset(
  species: string,
  moveset: Moveset,
  options?: ResolveOptions
): PokemonSet {
  const choose = makeChooser(options);

  const moves: string[] = [];
  for (const slot of moveset.moves) {
    const fresh = alternatives(slot).filter(m => !moves.includes(m));
    if (fresh.length === 0) continue; // every option already chosen by an earlier slot
    moves.push(fresh[choose(fresh.length)]);
  }

  const natures = moveset.nature ? alternatives(moveset.nature) : [];
  const spreads = moveset.evs ? alternatives(moveset.evs) : [];
  const natureIndex = natures.length > 1 ? choose(natures.length) : 0;
  const paired = natures.length > 1 && natures.length === spreads.length;
  const spreadIndex = paired ? natureIndex : spreads.length > 1 ? choose(spreads.length) : 0;

  const ivsList = moveset.ivs ? alternatives(moveset.ivs) : [];
  const teratypes = moveset.teratypes ? alternatives(moveset.teratypes) : [];
  const levels = moveset.level !== undefined ? alternatives(moveset.level) : [];

  return {
    name: species,
    species,
    item: moveset.item ? alternatives(moveset.item)[choose(alternatives(moveset.item).length)] : '',
    ability: moveset.ability
      ? alternatives(moveset.ability)[choose(alternatives(moveset.ability).length)]
      : defaultAbility(species),
    moves,
    nature: natures.length ? natures[natureIndex] : 'Serious',
    gender: '',
    evs: {...EMPTY_EVS, ...(spreads.length ? spreads[spreadIndex] : {})},
    ivs: {...FULL_IVS, ...(ivsList.length ? ivsList[choose(ivsList.length)] : {})},
    level: levels.length ? levels[choose(levels.length)] : 100,
    ...(teratypes.length ? {teraType: teratypes[choose(teratypes.length)]} : {}),
  };
}

/** Summarize which fields of a moveset are slashed. */
export function slashInfo(moveset: Moveset): SlashInfo {
  const info: SlashInfo = {moveSlots: []};
  moveset.moves.forEach((slot, i) => {
    if (Array.isArray(slot) && slot.length > 1) {
      info.moveSlots.push({slot: i, options: slot});
    }
  });
  if (Array.isArray(moveset.ability) && moveset.ability.length > 1) {
    info.ability = moveset.ability;
  }
  if (Array.isArray(moveset.item) && moveset.item.length > 1) info.item = moveset.item;
  if (Array.isArray(moveset.nature) && moveset.nature.length > 1) info.nature = moveset.nature;
  if (Array.isArray(moveset.teratypes) && moveset.teratypes.length > 1) {
    info.teratypes = moveset.teratypes;
  }
  if (Array.isArray(moveset.evs) && moveset.evs.length > 1) info.evSpreads = moveset.evs.length;
  return info;
}
