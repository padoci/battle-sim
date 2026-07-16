import type {MonState, SideState} from '../snapshot';
import type {DamageEntry} from './table';

/**
 * Cheap state scalars applied to precomputed base rolls at read time
 * (eval spec §4a). This is deliberately approximate — a horizon heuristic;
 * the sim computes real damage on every actual transition. Known accepted
 * gaps: Guts/Facade/Marvel Scale-style interactions, sand SpD, terrain.
 */

export interface FieldContext {
  /** Sim weather id: '' | 'sunnyday' | 'raindance' | 'sandstorm' | 'snowscape' | ... */
  weather: string;
}

/** Exact stage multiplier: +1 -> 1.5, +2 -> 2, -1 -> 2/3 ... */
export function stageMultiplier(stage: number): number {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

/** The combined damage scalar for an entry read under the current state. */
export function damageScalar(
  entry: DamageEntry,
  atk: MonState,
  def: MonState,
  defSide: SideState,
  field: FieldContext
): number {
  if (entry.category === 'Status') return 0;
  let scalar = 1;

  // Offensive/defensive stages of the relevant pair.
  if (entry.category === 'Physical') {
    scalar *= stageMultiplier(atk.boosts.atk) / stageMultiplier(def.boosts.def);
  } else {
    scalar *= stageMultiplier(atk.boosts.spa) / stageMultiplier(def.boosts.spd);
  }

  // Screens on the defender's side (reductions don't stack in-game).
  const screened =
    defSide.screens.auroraveil ||
    (entry.category === 'Physical' ? defSide.screens.reflect : defSide.screens.lightscreen);
  if (screened) scalar *= 0.5;

  // Burn halves physical damage.
  if (entry.category === 'Physical' && atk.status === 'brn') scalar *= 0.5;

  // Weather vs Fire/Water.
  if (entry.moveType === 'Fire') {
    if (field.weather === 'sunnyday') scalar *= 1.5;
    if (field.weather === 'raindance') scalar *= 0.5;
  } else if (entry.moveType === 'Water') {
    if (field.weather === 'raindance') scalar *= 1.5;
    if (field.weather === 'sunnyday') scalar *= 0.5;
  }

  return scalar;
}

/** Expected damage as a fraction of the defender's max HP, state-adjusted. */
export function modifiedFrac(
  entry: DamageEntry,
  atk: MonState,
  def: MonState,
  defSide: SideState,
  field: FieldContext
): number {
  if (def.maxhp <= 0) return 0;
  return (entry.expected * damageScalar(entry, atk, def, defSide, field)) / def.maxhp;
}

/** Probability the scaled rolls KO the defender from its CURRENT hp. */
export function koProb(
  entry: DamageEntry,
  atk: MonState,
  def: MonState,
  defSide: SideState,
  field: FieldContext
): number {
  if (!entry.rolls.length || def.hp <= 0) return 0;
  const scalar = damageScalar(entry, atk, def, defSide, field);
  const kos = entry.rolls.filter(roll => roll * scalar >= def.hp).length;
  return kos / entry.rolls.length;
}
