import type {Battle, Pokemon} from '@pkmn/sim';

export type StatusId = '' | 'brn' | 'par' | 'slp' | 'frz' | 'psn' | 'tox';

export interface BoostsTable {
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
  accuracy: number;
  evasion: number;
}

/** Frozen, JSON-able view of one Pokémon, detached from the live battle. */
export interface MonState {
  /** Position in the side's current pokemon array (0 = active slot). */
  slot: number;
  speciesId: string;
  hp: number;
  maxhp: number;
  fainted: boolean;
  boosts: BoostsTable;
  status: StatusId;
  volatiles: string[];
  /** Current item/ability ids ('' when consumed) — the invalidation keys. */
  itemId: string;
  abilityId: string;
  teraType: string;
  terastallized: boolean;
  /** Unboosted post-nature Speed (storedStats). */
  spe: number;
  /** Current move ids in slot order (calc-table column mapping). */
  moveIds: string[];
  isActive: boolean;
}

export interface SideState {
  mons: MonState[];
  /** Index into `mons` of the active Pokémon (-1 if none, e.g. all fainted). */
  activeIndex: number;
  /** Hazards this side is UNDER (sim stores them on the suffering side). */
  hazards: {stealthrock: boolean; spikes: 0 | 1 | 2 | 3; toxicspikes: 0 | 1 | 2; stickyweb: boolean};
  /** Screens etc. this side OWNS. */
  screens: {reflect: boolean; lightscreen: boolean; auroraveil: boolean};
  tailwind: boolean;
  safeguard: boolean;
  teraUsed: boolean;
}

export interface BattleState {
  sides: [SideState, SideState];
  weather: string;
  terrain: string;
  trickRoom: boolean;
  turn: number;
}

function extractMon(pokemon: Pokemon, slot: number): MonState {
  return {
    slot,
    speciesId: pokemon.species.id,
    hp: pokemon.hp,
    maxhp: pokemon.maxhp,
    fainted: pokemon.fainted,
    boosts: {...pokemon.boosts},
    status: pokemon.status as StatusId,
    volatiles: Object.keys(pokemon.volatiles),
    itemId: pokemon.item,
    abilityId: pokemon.ability,
    teraType: pokemon.teraType ?? '',
    terastallized: !!pokemon.terastallized,
    spe: pokemon.storedStats.spe,
    moveIds: pokemon.moveSlots.map(m => m.id),
    isActive: pokemon.isActive,
  };
}

/** Extract the eval-facing state from a live battle (deep-copied POJO). */
export function extractState(battle: Battle): BattleState {
  const sides = battle.sides.slice(0, 2).map(side => {
    const mons = side.pokemon.map(extractMon);
    const sc = side.sideConditions;
    return {
      mons,
      activeIndex: mons.findIndex(m => m.isActive),
      hazards: {
        stealthrock: !!sc['stealthrock'],
        spikes: (sc['spikes']?.layers ?? 0) as 0 | 1 | 2 | 3,
        toxicspikes: (sc['toxicspikes']?.layers ?? 0) as 0 | 1 | 2,
        stickyweb: !!sc['stickyweb'],
      },
      screens: {
        reflect: !!sc['reflect'],
        lightscreen: !!sc['lightscreen'],
        auroraveil: !!sc['auroraveil'],
      },
      tailwind: !!sc['tailwind'],
      safeguard: !!sc['safeguard'],
      teraUsed: side.pokemon.some(p => !!p.terastallized),
    } satisfies SideState;
  });

  return {
    sides: sides as [SideState, SideState],
    weather: battle.field.weather,
    terrain: battle.field.terrain,
    trickRoom: !!battle.field.pseudoWeather['trickroom'],
    turn: battle.turn,
  };
}
