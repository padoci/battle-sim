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
  | 'bulky-offense'
  | 'stall'
  | 'semi-stall'
  | 'balance';

/** A gimmick/strategy descriptor layered on top of the primary archetype. */
export type ArchetypeTag = 'webs' | 'hazard-stack' | 'type-spam';

export interface ArchetypeFeatures {
  weatherSetter?: {species: string; weather: 'rain' | 'sun' | 'sand' | 'snow'};
  terrainSetter?: {species: string; terrain: 'electric' | 'grassy' | 'psychic' | 'misty'};
  offensiveCount: number;
  defensiveCount: number;
  offensiveMons: string[];
  defensiveMons: string[];
  /** A notable shared strategy, if the roster clearly commits to one. */
  tag?: ArchetypeTag;
  /** The shared type behind a 'type-spam' tag, e.g. "Water". */
  spamType?: string;
  /** 1-2 signature mons (setup sweepers > weather/terrain setter > other
   *  offensive threats), used to personalize a team's display name. */
  keyMons: string[];
}

export interface ArchetypeResult {
  primary: ArchetypeId;
  secondary?: ArchetypeId;
  /** Display label, e.g. "Rain HO", "Hazard Stack Stall", "Balance". */
  label: string;
  /** The evidence — surfaced so a competitive user can sanity-check the call. */
  features: ArchetypeFeatures;
}

/** Tunables (first-pass; see module doc). */
export const THRESHOLDS = {
  /** Mons out of 6 counting as offensive to call the team Hyper Offense —
   *  deliberately high: 4 attackers backed by 2 real pivots reads as Bulky
   *  Offense/Balance in real OU, not HO. */
  hyperOffenseCount: 5,
  /** Mons out of 6 counting as defensive to call the team Stall. */
  stallCount: 5,
  /** Defensive-mon floor for Semi Stall (a stall core plus 1-2 breakers). */
  semiStallCount: 3,
  /** Offensive-mon ceiling for Semi Stall — above this it's just Balance. */
  semiStallMaxOffense: 2,
  /** Offensive-mon floor for Bulky Offense (an offensive core with real bulk behind it). */
  bulkyOffenseCount: 3,
  /** hp+def+spd EV total marking a bulky spread. */
  bulkEvs: 340,
  /** Speed EV floor (with an offensive nature) marking a fast attacker. */
  speedEvs: 252,
  /** Distinct mons needed to call two+ hazards a deliberate "stack". */
  hazardStackSetters: 2,
  /** Mons sharing a type needed to call it "spam" rather than coincidence. */
  typeSpamCount: 4,
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

const HAZARD_MOVES = new Set(['stealthrock', 'spikes', 'toxicspikes', 'stickyweb']);

/** Meta staples so common they're a weak "signature" for a specific team —
 * deprioritized (not excluded) when picking a team's 1-2 key mons, so the
 * name highlights what's actually distinctive about this particular roster. */
const STAPLE_SPECIES = new Set([
  'kingambit', 'greattusk', 'gholdengo', 'ragingbolt', 'dragonite',
  'cinderace', 'gliscor', 'kyurem', 'dragapult', 'landorustherian',
  'tinglu', 'zamazenta', 'slowkinggalar',
]);

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
  'bulky-offense': 'Bulky Offense',
  stall: 'Stall',
  'semi-stall': 'Semi Stall',
  balance: 'Balance',
};

const id = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function selfBoostMove(gen: Generation, name: string): boolean {
  const move = gen.moves.get(name);
  if (!move || move.target !== 'self' || !move.boosts) return false;
  const boosts = move.boosts as Partial<Record<'atk' | 'spa' | 'spe', number>>;
  return (boosts.atk ?? 0) > 0 || (boosts.spa ?? 0) > 0 || (boosts.spe ?? 0) > 0;
}

function isOffensive(gen: Generation, set: PokemonSet): boolean {
  const fastAndMean =
    (set.evs?.spe ?? 0) >= THRESHOLDS.speedEvs && OFFENSIVE_NATURES.has(set.nature);
  if (fastAndMean) return true;
  const item = set.item ? gen.items.get(set.item) : undefined;
  if (item && (item.isChoice || item.id === 'boosterenergy')) return true;
  return set.moves.some(name => selfBoostMove(gen, name));
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

function tagLabel(features: ArchetypeFeatures): string {
  if (features.tag === 'webs') return 'Webs';
  if (features.tag === 'hazard-stack') return 'Hazard Stack';
  if (features.tag === 'type-spam') return `${features.spamType} Spam`;
  return '';
}

/** Compute the transparent feature set (exported for tuning + tests). */
export function extractFeatures(gen: Generation, team: PokemonSet[]): ArchetypeFeatures {
  const features: ArchetypeFeatures = {
    offensiveCount: 0,
    defensiveCount: 0,
    offensiveMons: [],
    defensiveMons: [],
    keyMons: [],
  };
  const hazardKinds = new Set<string>();
  const hazardSetters = new Set<string>();
  const typeCounts = new Map<string, string[]>();
  const setupMons: string[] = [];
  let hasWebs = false;

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

    for (const moveName of set.moves) {
      const move = gen.moves.get(moveName);
      if (!move) continue;
      if (HAZARD_MOVES.has(move.id)) {
        hazardKinds.add(move.id);
        hazardSetters.add(set.species);
        if (move.id === 'stickyweb') hasWebs = true;
      }
      if (selfBoostMove(gen, moveName)) setupMons.push(set.species);
    }

    for (const type of gen.species.get(set.species)?.types ?? []) {
      const list = typeCounts.get(type) ?? [];
      list.push(set.species);
      typeCounts.set(type, list);
    }
  }

  let spamType: string | undefined;
  let spamCount = 0;
  for (const [type, species] of typeCounts) {
    if (species.length >= THRESHOLDS.typeSpamCount && species.length > spamCount) {
      spamType = type;
      spamCount = species.length;
    }
  }

  if (hasWebs) {
    features.tag = 'webs';
  } else if (hazardKinds.size >= 2 && hazardSetters.size >= THRESHOLDS.hazardStackSetters) {
    features.tag = 'hazard-stack';
  } else if (spamType) {
    features.tag = 'type-spam';
    features.spamType = spamType;
  }

  const keyCandidates = [...new Set([
    ...setupMons,
    features.weatherSetter?.species,
    features.terrainSetter?.species,
    ...features.offensiveMons,
  ].filter((species): species is string => !!species))];
  // Prefer whatever's distinctive about this roster over the same handful of
  // meta staples that would otherwise dominate every team's key mons.
  const distinctive = keyCandidates.filter(species => !STAPLE_SPECIES.has(id(species)));
  const staple = keyCandidates.filter(species => STAPLE_SPECIES.has(id(species)));
  features.keyMons = [...distinctive, ...staple].slice(0, 2);

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
  } else if (
    features.defensiveCount >= THRESHOLDS.semiStallCount &&
    features.offensiveCount <= THRESHOLDS.semiStallMaxOffense
  ) {
    primary = 'semi-stall';
  } else if (features.offensiveCount >= THRESHOLDS.hyperOffenseCount) {
    primary = 'hyper-offense';
  } else if (features.offensiveCount >= THRESHOLDS.bulkyOffenseCount && features.defensiveCount >= 2) {
    primary = 'bulky-offense';
  } else {
    primary = 'balance';
  }

  let secondary: ArchetypeId | undefined;
  if (features.weatherSetter || features.terrainSetter) {
    if (features.offensiveCount >= THRESHOLDS.hyperOffenseCount) secondary = 'hyper-offense';
    else if (features.defensiveCount >= THRESHOLDS.stallCount) secondary = 'stall';
  }

  const base = secondary
    ? `${LABELS[primary]} ${secondary === 'hyper-offense' ? 'HO' : LABELS[secondary]}`
    : LABELS[primary];
  const label = features.tag ? `${tagLabel(features)} ${base}` : base;
  return {primary, secondary, label, features};
}

/**
 * A friendly display name for an opponent team: its archetype label plus 1-2
 * signature mons, e.g. "Hazard Stack Stall (Toxapex + Ting-Lu)" or
 * "Rain HO (Pelipper + Barraskewda)". Deterministic and never the bare
 * "Team #N" index placeholder — used unconditionally in place of any raw
 * stored team name, since mined/vendored names are often ugly ladder-scrape
 * artifacts.
 */
export function teamDisplayName(gen: Generation, sets: PokemonSet[]): string {
  const {label, features} = classifyTeam(gen, sets);
  const keyMons = features.keyMons.length > 0 ? features.keyMons : [sets[0]?.species ?? 'Mystery'];
  return `${label} (${keyMons.join(' + ')})`;
}
