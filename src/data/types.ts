import type {PokemonSet, StatsTable} from '@pkmn/data';

/**
 * Wire format of one moveset in data.pkmn.cc `/sets/{format}.json`.
 *
 * This mirrors @pkmn/smogon's `Moveset` type, with two divergences measured
 * against the real gen9ou payload (2026-07):
 * - `teratypes` can be a bare string, not only an array.
 * - name types are plain strings (no branded types) so fixture JSON loads
 *   without casts.
 *
 * Any field typed `T | T[]` is a "slash": an array lists alternatives.
 * `moves` is an array of slots (usually 4, but e.g. Ditto has 1), each slot
 * itself possibly slashed.
 */
export interface Moveset {
  level?: number | number[];
  /** Omitted by many real sets — the species' default ability is implied. */
  ability?: string | string[];
  item?: string | string[];
  nature?: string | string[];
  ivs?: Partial<StatsTable> | Partial<StatsTable>[];
  evs?: Partial<StatsTable> | Partial<StatsTable>[];
  moves: Array<string | string[]>;
  teratypes?: string | string[];
}

/** `/sets/{format}.json`: species name -> set name -> moveset. */
export type SetsData = Record<string, Record<string, Moveset>>;

/**
 * Per-Pokémon entry of `/stats/{format}.json`. This is the *legacy* display
 * stats shape (converted smogon.com/stats report) — the format files on
 * data.pkmn.cc use it; there is no `unique`/`win`/`stats` key.
 */
export interface LegacyPokemonStats {
  lead?: {raw: number; real: number; weighted: number};
  usage: {raw: number; real: number; weighted: number};
  count: number;
  weight: number | null;
  viability: [number, number, number, number];
  abilities: Record<string, number>;
  items: Record<string, number>;
  moves: Record<string, number>;
  teraTypes?: Record<string, number>;
  teammates: Record<string, number>;
  spreads: Record<string, number>;
  /** opposing species -> [score, %KOed, %switched out] */
  counters: Record<string, [number, number, number]>;
  happinesses?: Record<string, number>;
}

/** `/stats/{format}.json`. */
export interface StatsData {
  battles: number;
  pokemon: Record<string, LegacyPokemonStats>;
  metagame?: {
    tags: Record<string, number>;
    stalliness?: {histogram: Array<[number, number]>; mean: number; total: number};
  };
}

/**
 * Wire format of one team member in `/teams/{format}.json`. Sets there are
 * already concrete (no slashes) but sparser than a full `PokemonSet`:
 * no name/gender/level, partial evs/ivs, and `teraType` singular.
 */
export interface TeamMemberWire {
  species: string;
  item?: string;
  ability: string;
  teraType?: string;
  nature?: string;
  gender?: string;
  level?: number;
  evs?: Partial<StatsTable>;
  ivs?: Partial<StatsTable>;
  moves: string[];
}

/**
 * One entry of `/teams/{format}.json`. Note @pkmn/smogon does not export its
 * `Team` type, and `name`/`author` are absent for some real entries.
 */
export interface Team {
  name?: string | null;
  author?: string | null;
  data: TeamMemberWire[];
}

/**
 * One entry of `gym-leader-teams.gen9ou.json` (Gym Leader mode's opponent
 * pool): a real trainer's expanded roster, tagged by their signature type
 * (used to draw 5 mutually-distinct-type rungs) and whether they're a
 * champion (drawn separately, for the gauntlet's final rung).
 */
export interface GymLeaderTeam extends Team {
  signatureType: string;
  isChampion: boolean;
}

/** One species in the draft pool (sets ⋈ usage stats). */
export interface PoolEntry {
  species: string;
  setNames: string[];
  /** `usage.weighted` from stats; 0 when the species has no stats entry. */
  usageWeighted: number;
}

export type {PokemonSet, StatsTable};
