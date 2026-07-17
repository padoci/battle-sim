import type {Generation} from '@pkmn/data';
import type {PokemonSet} from '../data/types';

/**
 * Rule-based team-archetype classifier (ui-spec §6c): transparent features
 * plus a small decision tree — no ML, no training data. All numeric
 * thresholds here are FIRST-PASS, invented per ui-spec §9's open item, and
 * expected to get hand-tuning against real team data.
 */
export type ArchetypeId =
  | 'rain'
  | 'sun'
  | 'sand'
  | 'snow'
  | 'electric-terrain'
  | 'grassy-terrain'
  | 'psychic-terrain'
  | 'misty-terrain'
  | 'hyper-offense'
  | 'stall'
  | 'balance';

export interface ArchetypeFeatures {
  weatherSetter?: {species: string; weather: 'rain' | 'sun' | 'sand' | 'snow'};
  terrainSetter?: {species: string; terrain: 'electric' | 'grassy' | 'psychic' | 'misty'};
  offensiveCount: number;
  defensiveCount: number;
  offensiveMons: string[];
  defensiveMons: string[];
}

export interface ArchetypeResult {
  primary: ArchetypeId;
  secondary?: ArchetypeId;
  /** Display label, e.g. "Rain HO", "Stall", "Balance". */
  label: string;
  /** The evidence — surfaced so a competitive user can sanity-check the call. */
  features: ArchetypeFeatures;
}

/** Tunables (first-pass; see module doc). */
export const THRESHOLDS = {
  /** Mons out of 6 counting as offensive to call the team Hyper Offense. */
  hyperOffenseCount: 4,
  /** Mons out of 6 counting as defensive to call the team Stall. */
  stallCount: 4,
  /** hp+def+spd EV total marking a bulky spread. */
  bulkEvs: 340,
  /** Speed EV floor (with an offensive nature) marking a fast attacker. */
  speedEvs: 252,
} as const;

const WEATHER_ABILITIES: Record<string, 'rain' | 'sun' | 'sand' | 'snow'> = {
  drizzle: 'rain',
  drought: 'sun',
  orichalcumpulse: 'sun',
  sandstream: 'sand',
  snowwarning: 'snow',
};

const TERRAIN_ABILITIES: Record<string, NonNullable<ArchetypeFeatures['terrainSetter']>['terrain']> = {
  electricsurge: 'electric',
  hadronengine: 'electric',
  grassysurge: 'grassy',
  psychicsurge: 'psychic',
  mistysurge: 'misty',
};

const WEATHER_ARCHETYPE: Record<string, ArchetypeId> = {
  rain: 'rain',
  sun: 'sun',
  sand: 'sand',
  snow: 'snow',
};

const OFFENSIVE_NATURES = new Set([
  'Adamant', 'Lonely', 'Naughty', 'Brave',
  'Modest', 'Mild', 'Quiet', 'Rash',
  'Timid', 'Jolly', 'Naive', 'Hasty',
]);

const LABELS: Record<ArchetypeId, string> = {
  rain: 'Rain',
  sun: 'Sun',
  sand: 'Sand',
  snow: 'Snow',
  'electric-terrain': 'Electric Terrain',
  'grassy-terrain': 'Grassy Terrain',
  'psychic-terrain': 'Psychic Terrain',
  'misty-terrain': 'Misty Terrain',
  'hyper-offense': 'Hyper Offense',
  stall: 'Stall',
  balance: 'Balance',
};

const id = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function isOffensive(gen: Generation, set: PokemonSet): boolean {
  const fastAndMean =
    (set.evs?.spe ?? 0) >= THRESHOLDS.speedEvs && OFFENSIVE_NATURES.has(set.nature);
  if (fastAndMean) return true;
  const item = set.item ? gen.items.get(set.item) : undefined;
  if (item && (item.isChoice || item.id === 'boosterenergy')) return true;
  return set.moves.some(name => {
    const move = gen.moves.get(name);
    if (!move || move.target !== 'self' || !move.boosts) return false;
    const boosts = move.boosts as Partial<Record<'atk' | 'spa' | 'spe', number>>;
    return (boosts.atk ?? 0) > 0 || (boosts.spa ?? 0) > 0 || (boosts.spe ?? 0) > 0;
  });
}

function isDefensive(gen: Generation, set: PokemonSet): boolean {
  const bulk = (set.evs?.hp ?? 0) + (set.evs?.def ?? 0) + (set.evs?.spd ?? 0);
  if (bulk >= THRESHOLDS.bulkEvs) return true;
  return set.moves.some(name => {
    const move = gen.moves.get(name);
    if (!move) return false;
    const heals = !!move.heal || !!(move.flags as {heal?: number}).heal;
    const hazard = move.target === 'foeSide';
    const phazes = !!move.forceSwitch;
    return heals || hazard || phazes;
  });
}

/** Compute the transparent feature set (exported for tuning + tests). */
export function extractFeatures(gen: Generation, team: PokemonSet[]): ArchetypeFeatures {
  const features: ArchetypeFeatures = {
    offensiveCount: 0,
    defensiveCount: 0,
    offensiveMons: [],
    defensiveMons: [],
  };
  for (const set of team) {
    const ability = id(set.ability);
    const weather = WEATHER_ABILITIES[ability];
    if (weather && !features.weatherSetter) {
      features.weatherSetter = {species: set.species, weather};
    }
    const terrain = TERRAIN_ABILITIES[ability];
    if (terrain && !features.terrainSetter) {
      features.terrainSetter = {species: set.species, terrain};
    }
    if (isOffensive(gen, set)) {
      features.offensiveCount++;
      features.offensiveMons.push(set.species);
    }
    if (isDefensive(gen, set)) {
      features.defensiveCount++;
      features.defensiveMons.push(set.species);
    }
  }
  return features;
}

export function classifyTeam(gen: Generation, team: PokemonSet[]): ArchetypeResult {
  const features = extractFeatures(gen, team);

  let primary: ArchetypeId;
  if (features.weatherSetter) {
    primary = WEATHER_ARCHETYPE[features.weatherSetter.weather];
  } else if (features.terrainSetter) {
    primary = `${features.terrainSetter.terrain}-terrain` as ArchetypeId;
  } else if (features.defensiveCount >= THRESHOLDS.stallCount) {
    primary = 'stall';
  } else if (features.offensiveCount >= THRESHOLDS.hyperOffenseCount) {
    primary = 'hyper-offense';
  } else {
    primary = 'balance';
  }

  let secondary: ArchetypeId | undefined;
  if (features.weatherSetter || features.terrainSetter) {
    if (features.offensiveCount >= THRESHOLDS.hyperOffenseCount) secondary = 'hyper-offense';
    else if (features.defensiveCount >= THRESHOLDS.stallCount) secondary = 'stall';
  }

  const label = secondary
    ? `${LABELS[primary]} ${secondary === 'hyper-offense' ? 'HO' : LABELS[secondary]}`
    : LABELS[primary];
  return {primary, secondary, label, features};
}
