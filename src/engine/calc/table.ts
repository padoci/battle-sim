import {calculate, Move as CalcMove, Pokemon as CalcPokemon} from '@smogon/calc';
import type {Generation} from '@pkmn/data';
import type {PokemonSet} from '../../data/types';
import type {BattleState, MonState} from '../snapshot';

/**
 * Base damage of one (attacker, move, defender) combination at NEUTRAL
 * state: no boosts, full HP, no status, no screens, no weather. Everything
 * state-dependent is applied later as cheap scalars (see modifiers.ts); the
 * Tera dimension gets its own slices because Tera changes effectiveness
 * buckets and is not a scalar (eval spec §4b).
 */
export interface DamageEntry {
  /** The base damage rolls (16 for standard moves, 1 for fixed damage, empty for status moves). */
  rolls: number[];
  /** Mean roll, absolute HP. */
  expected: number;
  /** expected / defender maxhp at build time. */
  expectedFrac: number;
  category: 'Physical' | 'Special' | 'Status';
  moveType: string;
}

/** 2×2 Tera slices: [attackerTera 0|1][defenderTera 0|1]. */
export type TeraSlices = [[DamageEntry, DamageEntry], [DamageEntry, DamageEntry]];

/** What each mon's rows/columns were computed with — the §4d invalidation key. */
export interface MonIdentity {
  speciesId: string;
  itemId: string;
  abilityId: string;
  moveIds: string[];
}

interface MonEntry {
  set: PokemonSet;
  identity: MonIdentity;
  /** vs[defSpeciesId][moveIndex] -> 2x2 Tera slices. */
  vs: Record<string, TeraSlices[]>;
}

export interface CalcTable {
  gen: Generation;
  /** mons[side][speciesId] */
  mons: [Record<string, MonEntry>, Record<string, MonEntry>];
}

interface CalcState {
  itemName?: string;
  abilityName?: string;
  moveNames: string[];
}

function toCalcState(set: PokemonSet): CalcState {
  return {
    itemName: set.item || undefined,
    abilityName: set.ability || undefined,
    moveNames: set.moves,
  };
}

function makePokemon(gen: Generation, set: PokemonSet, state: CalcState, tera: boolean): CalcPokemon {
  return new CalcPokemon(gen as never, set.species, {
    level: set.level,
    item: state.itemName,
    ability: state.abilityName,
    nature: set.nature,
    evs: set.evs,
    ivs: set.ivs,
    ...(tera && set.teraType ? {teraType: set.teraType as never} : {}),
  });
}

function toEntry(gen: Generation, attacker: CalcPokemon, defender: CalcPokemon, moveName: string): DamageEntry {
  const move = new CalcMove(gen as never, moveName);
  const result = calculate(gen as never, attacker, defender, move);
  const raw = result.damage;
  const rolls = Array.isArray(raw)
    ? (raw as Array<number | number[]>).flat().filter(d => d > 0)
    : raw > 0
      ? [raw as number]
      : [];
  const expected = rolls.length ? rolls.reduce((a, b) => a + b, 0) / rolls.length : 0;
  const maxhp = defender.maxHP();
  return {
    rolls,
    expected,
    expectedFrac: maxhp > 0 ? expected / maxhp : 0,
    category: move.category ?? 'Status',
    moveType: move.type,
  };
}

function buildSlices(
  gen: Generation,
  atkSet: PokemonSet,
  atkState: CalcState,
  defSet: PokemonSet,
  defState: CalcState,
  moveName: string
): TeraSlices {
  const slice = (atkTera: boolean, defTera: boolean) =>
    toEntry(
      gen,
      makePokemon(gen, atkSet, atkState, atkTera),
      makePokemon(gen, defSet, defState, defTera),
      moveName
    );
  return [
    [slice(false, false), slice(false, true)],
    [slice(true, false), slice(true, true)],
  ];
}

function identityOf(gen: Generation, set: PokemonSet, state: CalcState): MonIdentity {
  const id = (name: string | undefined, kind: 'species' | 'items' | 'abilities' | 'moves') =>
    name ? ((gen[kind === 'species' ? 'species' : kind].get(name)?.id as string) ?? '') : '';
  return {
    speciesId: id(set.species, 'species'),
    itemId: id(state.itemName, 'items'),
    abilityId: id(state.abilityName, 'abilities'),
    moveIds: state.moveNames.map(m => id(m, 'moves')),
  };
}

/**
 * Precompute the per-battle base-roll table: every mon's every move vs every
 * opposing mon, in all four Tera combinations (2 attacker × 2 defender —
 * the spec's "two slices per mon" requires the full 2×2 per pair since
 * defender Tera flips effectiveness buckets too). ~1,150 calc calls, run
 * once per battle.
 *
 * Keyed by species id (stable across the sim's switch-reordering of
 * `side.pokemon`), which assumes Species Clause — asserted here.
 */
export function buildCalcTable(gen: Generation, teams: [PokemonSet[], PokemonSet[]]): CalcTable {
  const mons: CalcTable['mons'] = [{}, {}];
  for (const side of [0, 1] as const) {
    for (const set of teams[side]) {
      const state = toCalcState(set);
      const identity = identityOf(gen, set, state);
      if (mons[side][identity.speciesId]) {
        throw new Error(`duplicate species on side ${side + 1}: ${set.species} (Species Clause assumed)`);
      }
      mons[side][identity.speciesId] = {set, identity, vs: {}};
    }
  }
  const table: CalcTable = {gen, mons};
  for (const side of [0, 1] as const) {
    for (const atk of Object.values(mons[side])) {
      rebuildRows(table, side, atk, toCalcState(atk.set));
    }
  }
  return table;
}

function rebuildRows(table: CalcTable, side: 0 | 1, atk: MonEntry, atkState: CalcState): void {
  const {gen} = table;
  atk.vs = {};
  for (const def of Object.values(table.mons[1 - side]!)) {
    const defState = currentCalcState(gen, def);
    atk.vs[def.identity.speciesId] = atkState.moveNames.map(moveName =>
      buildSlices(gen, atk.set, atkState, def.set, defState, moveName)
    );
  }
}

/** The defender-side calc state a mon's columns were last built with. */
function currentCalcState(gen: Generation, mon: MonEntry): CalcState {
  return {
    itemName: mon.identity.itemId ? (gen.items.get(mon.identity.itemId)?.name ?? undefined) : undefined,
    abilityName: mon.identity.abilityId
      ? (gen.abilities.get(mon.identity.abilityId)?.name ?? undefined)
      : undefined,
    moveNames: mon.identity.moveIds.map(id => gen.moves.get(id)?.name ?? ''),
  };
}

/**
 * §4d invalidation, poll-on-read: compare each mon's live identity (current
 * item/ability/species/moves from the BattleState) against what its table
 * rows were built with; on mismatch rebuild that mon's attacker rows and
 * every opposing mon's rows against it. Boosts/screens/weather/status stay
 * scalars — no rebuild. Returns the number of mons rebuilt.
 */
export function ensureFresh(table: CalcTable, state: BattleState): number {
  let rebuilt = 0;
  for (const side of [0, 1] as const) {
    const sideMons = table.mons[side];

    // Forme changes rename species ids: re-key orphaned entries to the
    // unmatched state mons (pairing is 1:1 in practice — one mon changes).
    const stateIds = new Set(state.sides[side].mons.map(m => m.speciesId));
    const orphans = Object.keys(sideMons).filter(id => !stateIds.has(id));
    const newcomers = state.sides[side].mons.filter(m => !sideMons[m.speciesId]);
    for (let i = 0; i < Math.min(orphans.length, newcomers.length); i++) {
      const entry = sideMons[orphans[i]];
      delete sideMons[orphans[i]];
      const species = table.gen.species.get(newcomers[i].speciesId);
      entry.set = {...entry.set, species: species?.name ?? entry.set.species};
      entry.identity = {...entry.identity, speciesId: newcomers[i].speciesId};
      sideMons[newcomers[i].speciesId] = entry;
    }

    for (const mon of state.sides[side].mons) {
      const entry = sideMons[mon.speciesId];
      if (!entry) continue;
      const id = entry.identity;
      const changed =
        id.itemId !== mon.itemId ||
        id.abilityId !== mon.abilityId ||
        id.moveIds.join(',') !== mon.moveIds.join(',');
      if (!changed) continue;

      entry.identity = {
        speciesId: mon.speciesId,
        itemId: mon.itemId,
        abilityId: mon.abilityId,
        moveIds: [...mon.moveIds],
      };
      // The changed mon's attacker rows, plus every opposing mon's rows
      // (they all have this mon as a defender column).
      rebuildRows(table, side, entry, currentCalcState(table.gen, entry));
      for (const opp of Object.values(table.mons[1 - side])) {
        rebuildRows(table, (1 - side) as 0 | 1, opp, currentCalcState(table.gen, opp));
      }
      rebuilt++;
    }
  }
  return rebuilt;
}

/**
 * Read the base entry for attacker's move vs defender under the current
 * Tera flags. Returns undefined for unknown species (e.g. un-rebuilt forme
 * change) or move index out of range.
 */
export function getEntry(
  table: CalcTable,
  atkSide: 0 | 1,
  atk: MonState,
  moveIndex: number,
  def: MonState
): DamageEntry | undefined {
  const slices = table.mons[atkSide][atk.speciesId]?.vs[def.speciesId]?.[moveIndex];
  return slices?.[atk.terastallized ? 1 : 0][def.terastallized ? 1 : 0];
}
