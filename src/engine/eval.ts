import type {BattleState, MonState, SideState} from './snapshot';
import {getEntry, type CalcTable} from './calc/table';
import {koProb, modifiedFrac, type FieldContext} from './calc/modifiers';

/**
 * Static position evaluator (eval-function-spec-v1.md). Zero lookahead:
 * scores one frozen state from a side's perspective. Baseline weights §3
 * are adopted from Foul Play; §4 divergences: calc-driven matchup term over
 * the precomputed table, Tera as scored state, all 12 mons fully scored
 * (omniscient).
 */
export const WEIGHTS = {
  ALIVE: 75,
  HP: 100,
  BOOST: {atk: 15, def: 15, spa: 15, spd: 15, spe: 25, accuracy: 3, evasion: 3},
  /** Diminishing-returns curve, indexed by stage + 6 (spec §3a). */
  DR: [-3.3, -3.15, -3, -2.5, -2, -1, 0, 1, 2, 2.5, 3, 3.15, 3.3],
  STATUS: {frz: -40, tox: -30, slp: -25, par: -25, psn: -10},
  /** Burn scales with how physical the mon is (see burnMultiplier). */
  BURN_BASE: -25,
  VOLATILE: {substitute: 40, leechseed: -30, confusion: -20},
  SIDE: {auroraveil: 40, reflect: 20, lightscreen: 20, tailwind: 7, safeguard: 5},
  STICKY_WEB: -25,
  /** Per living reserve, per layer (spec §3b count-scored hazards). */
  HAZARD_PER_RESERVE: {stealthrock: -10, spikes: -7, toxicspikes: -7},

  // §4 divergences — tunables, flagged by spec §6.
  /** Matchup-term weight; should taper as search depth rises (Stage 2). */
  MATCHUP: 20,
  /** Weight of expected-damage chip vs outright KO probability in threat. */
  CHIP_WEIGHT: 0.5,
  /** Threat discount when the threatening mon is slower. */
  SLOWER_DISCOUNT: 0.6,
  /**
   * Base option value of an unused Tera at full board (spec §4b). Decays with
   * game phase (see teraOptionValue): holding Tera is worth a lot early — many
   * future high-value windows remain, so wait — and ~nothing at the endgame,
   * where it's use-it-or-lose-it. Sized above a typical incremental Tera swing
   * so the AI only cashes Tera when it clearly changes an interaction (which,
   * because KO probability dominates the matchup term, is ~a KO-flip), rather
   * than on the first decent attack.
   */
  TERA_AVAILABLE: 30,
  /** The Tera option value decays to 0 by this many total faints (game phase). */
  TERA_DECAY_FAINTS: 8,
} as const;

/**
 * Burn is worse for physical attackers: -25 x (1 + physical share of
 * damaging moves) — pure physical -50, pure special -25. (Foul Play's exact
 * formula was unverifiable; this is our documented tunable definition.)
 */
export function burnMultiplier(physicalShare: number): number {
  return 1 + physicalShare;
}

/**
 * Dev-only tuning overrides (e.g. the gauntlet's ?tera=N knob). Defaults
 * stay untouched; overrides apply symmetrically to both sides, so the
 * zero-sum property is preserved by construction. Callers that run many
 * battles (the worker) must set this per battle — including clearing it.
 */
export interface EvalOverrides {
  /** Base Tera option value (WEIGHTS.TERA_AVAILABLE). */
  teraAvailable?: number;
  /** Faints over which the Tera option value decays (WEIGHTS.TERA_DECAY_FAINTS); ≤0 disables decay. */
  teraDecayFaints?: number;
}

let evalOverrides: EvalOverrides | undefined;

export function setEvalOverrides(overrides?: EvalOverrides): void {
  evalOverrides = overrides;
}

/** Total Pokémon fainted across both sides — a coarse game-phase clock. */
function totalFainted(state: BattleState): number {
  let n = 0;
  for (const side of state.sides) for (const mon of side.mons) if (mon.fainted) n++;
  return n;
}

/**
 * Option value of still holding Tera (spec §4b, redesigned). A base bonus that
 * decays with game phase: early (few faints) it's near full — holding Tera
 * preserves the option to spend it on the single highest-impact turn still to
 * come — and by the endgame it decays to 0, so the AI stops hoarding a resource
 * it can no longer profitably time. Global (both-side) faint count keeps it
 * symmetric, so the zero-sum property is preserved.
 */
function teraOptionValue(state: BattleState): number {
  const base = evalOverrides?.teraAvailable ?? WEIGHTS.TERA_AVAILABLE;
  const decayFaints = evalOverrides?.teraDecayFaints ?? WEIGHTS.TERA_DECAY_FAINTS;
  if (decayFaints <= 0) return base; // decay disabled → flat (A/B baseline)
  return base * Math.max(0, 1 - totalFainted(state) / decayFaints);
}

function boostScore(mon: MonState): number {
  let score = 0;
  for (const stat of ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'] as const) {
    score += WEIGHTS.DR[mon.boosts[stat] + 6] * WEIGHTS.BOOST[stat];
  }
  return score;
}

function statusScore(mon: MonState, physicalShare: number): number {
  if (!mon.status) return 0;
  if (mon.status === 'brn') return WEIGHTS.BURN_BASE * burnMultiplier(physicalShare);
  return WEIGHTS.STATUS[mon.status];
}

function volatileScore(mon: MonState): number {
  let score = 0;
  for (const [volatile, value] of Object.entries(WEIGHTS.VOLATILE)) {
    if (mon.volatiles.includes(volatile)) score += value;
  }
  return score;
}

/**
 * Per-Pokémon score (spec §3a). `physicalShare` is the share of the mon's
 * damaging moves that are physical (for the burn term) — pass 0.5 when
 * unknown.
 */
export function evaluatePokemon(mon: MonState, physicalShare = 0.5): number {
  if (mon.fainted || mon.hp <= 0) return 0;
  return (
    WEIGHTS.ALIVE +
    WEIGHTS.HP * (mon.hp / mon.maxhp) +
    boostScore(mon) +
    statusScore(mon, physicalShare) +
    volatileScore(mon)
  );
}

function livingReserves(side: SideState): number {
  return side.mons.filter(m => !m.fainted && !m.isActive).length;
}

/** Side-state score: screens/tailwind/safeguard + hazards x living reserves. */
function sideConditionScore(side: SideState): number {
  let score = 0;
  if (side.screens.auroraveil) score += WEIGHTS.SIDE.auroraveil;
  if (side.screens.reflect) score += WEIGHTS.SIDE.reflect;
  if (side.screens.lightscreen) score += WEIGHTS.SIDE.lightscreen;
  if (side.tailwind) score += WEIGHTS.SIDE.tailwind;
  if (side.safeguard) score += WEIGHTS.SIDE.safeguard;
  if (side.hazards.stickyweb) score += WEIGHTS.STICKY_WEB;

  const reserves = livingReserves(side);
  if (side.hazards.stealthrock) score += WEIGHTS.HAZARD_PER_RESERVE.stealthrock * reserves;
  score += WEIGHTS.HAZARD_PER_RESERVE.spikes * side.hazards.spikes * reserves;
  score += WEIGHTS.HAZARD_PER_RESERVE.toxicspikes * side.hazards.toxicspikes * reserves;
  return score;
}

function physicalShareOf(table: CalcTable, side: 0 | 1, mon: MonState): number {
  const entry = table.mons[side][mon.speciesId];
  if (!entry) return 0.5;
  const anyDef = Object.values(entry.vs)[0];
  if (!anyDef) return 0.5;
  const categories = anyDef.map(slices => slices[0][0].category).filter(c => c !== 'Status');
  if (!categories.length) return 0;
  return categories.filter(c => c === 'Physical').length / categories.length;
}

/** Effective speed for the matchup speed race (approximate, scalar-level). */
export function raceSpeed(mon: MonState, side: SideState): number {
  let speed = mon.spe * stageMult(mon.boosts.spe);
  if (mon.status === 'par') speed *= 0.5;
  if (side.tailwind) speed *= 2;
  return speed;
}

function stageMult(stage: number): number {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

/**
 * Which side's active is faster right now (Trick-Room aware); 'tie' on
 * exact effective-speed equality. The decomposed fact behind the matchup
 * term's speed factor — used by analysis/stats surfaces.
 */
export function fasterSide(state: BattleState, sideA: 0 | 1): 0 | 1 | 'tie' {
  const a = state.sides[sideA];
  const b = state.sides[(1 - sideA) as 0 | 1];
  const monA = a.mons[a.activeIndex];
  const monB = b.mons[b.activeIndex];
  if (!monA || !monB) return 'tie';
  const speedA = raceSpeed(monA, a);
  const speedB = raceSpeed(monB, b);
  if (speedA === speedB) return 'tie';
  let aFaster = speedA > speedB;
  if (state.trickRoom) aFaster = !aFaster;
  return aFaster ? sideA : ((1 - sideA) as 0 | 1);
}

/**
 * How threatening `atk` (active on atkSide) is to `def` right now:
 * best move's OHKO probability plus weighted expected chip, under the
 * current Tera slices.
 */
export function threat(
  table: CalcTable,
  atkSide: 0 | 1,
  atk: MonState,
  def: MonState,
  defSide: SideState,
  field: FieldContext
): number {
  const entry = table.mons[atkSide][atk.speciesId];
  if (!entry) return 0;
  let best = 0;
  for (let m = 0; m < atk.moveIds.length; m++) {
    const damage = getEntry(table, atkSide, atk, m, def);
    if (!damage || damage.category === 'Status') continue;
    const score =
      koProb(damage, atk, def, defSide, field) +
      WEIGHTS.CHIP_WEIGHT * Math.min(1, modifiedFrac(damage, atk, def, defSide, field));
    if (score > best) best = score;
  }
  return best;
}

/**
 * Matchup term (spec §4a): my active's threat on theirs minus the reverse,
 * each scaled by speed order (outspeeding a KO threat is worth more than
 * being outsped), x MATCHUP weight.
 */
function matchupScore(
  state: BattleState,
  table: CalcTable,
  pov: 0 | 1,
  matchupWeight: number
): number {
  const mySide = state.sides[pov];
  const theirSide = state.sides[1 - pov];
  const mine = mySide.mons[mySide.activeIndex];
  const theirs = theirSide.mons[theirSide.activeIndex];
  if (!mine || !theirs || mine.fainted || theirs.fainted) return 0;

  const field: FieldContext = {weather: state.weather};
  const mySpeed = raceSpeed(mine, mySide);
  const theirSpeed = raceSpeed(theirs, theirSide);

  // Speed tie -> both sides get the averaged factor, preserving zero-sum
  // antisymmetry (a strict order already flips cleanly between povs).
  let myFactor: number;
  let theirFactor: number;
  if (mySpeed === theirSpeed) {
    myFactor = theirFactor = (1 + WEIGHTS.SLOWER_DISCOUNT) / 2;
  } else {
    let iAmFaster = mySpeed > theirSpeed;
    if (state.trickRoom) iAmFaster = !iAmFaster;
    myFactor = iAmFaster ? 1 : WEIGHTS.SLOWER_DISCOUNT;
    theirFactor = iAmFaster ? WEIGHTS.SLOWER_DISCOUNT : 1;
  }

  return (
    matchupWeight *
    (threat(table, pov, mine, theirs, theirSide, field) * myFactor -
      threat(table, (1 - pov) as 0 | 1, theirs, mine, mySide, field) * theirFactor)
  );
}

function sideScore(state: BattleState, table: CalcTable, side: 0 | 1): number {
  const sideState = state.sides[side];
  let score = sideConditionScore(sideState);
  for (const mon of sideState.mons) {
    score += evaluatePokemon(mon, physicalShareOf(table, side, mon));
  }
  if (!sideState.teraUsed) score += teraOptionValue(state);
  return score;
}

/**
 * Zero-sum static evaluation from `pov`'s perspective:
 * `evaluate(s, t, 0) === -evaluate(s, t, 1)`.
 *
 * `matchupWeight` lets the search taper the horizon-shortcut matchup term
 * with depth (eval spec §4a) — deeper leaves lean on it less.
 */
export function evaluate(
  state: BattleState,
  table: CalcTable,
  pov: 0 | 1,
  matchupWeight: number = WEIGHTS.MATCHUP
): number {
  const own = sideScore(state, table, pov);
  const opp = sideScore(state, table, (1 - pov) as 0 | 1);
  return own - opp + matchupScore(state, table, pov, matchupWeight);
}
