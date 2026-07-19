import type {Battle} from '@pkmn/sim';
import type {Generation} from '@pkmn/data';
import {legalActions, type Action} from '../engine/actions';
import {raceSpeed, threat, weightedStatusMoveValue, WEIGHTS} from '../engine/eval';
import {getEntry, type CalcTable} from '../engine/calc/table';
import {koProb, modifiedFrac, type FieldContext} from '../engine/calc/modifiers';
import type {BattleState, MonState, SideState} from '../engine/snapshot';
import type {SearchConfig} from './config';

/**
 * Entry-hazard damage fraction a mon takes on switch-in (cheap, static —
 * the switch-pruning tax; the sim computes the real chip on transitions).
 */
export function hazardFrac(
  gen: Generation,
  mon: MonState,
  hazards: SideState['hazards']
): number {
  if (mon.itemId === 'heavydutyboots') return 0;
  let frac = 0;

  const species = gen.species.get(mon.speciesId);
  const types = (species?.types ?? []) as readonly (keyof NonNullable<
    ReturnType<Generation['types']['get']>
  >['effectiveness'])[];

  if (hazards.stealthrock) {
    let effectiveness = 1;
    const rock = gen.types.get('Rock');
    for (const type of types) {
      effectiveness *= rock?.effectiveness[type] ?? 1;
    }
    frac += 0.125 * effectiveness;
  }

  const grounded =
    !types.includes('Flying') && mon.abilityId !== 'levitate' && mon.itemId !== 'airballoon';
  if (grounded && hazards.spikes > 0) {
    frac += [0, 1 / 8, 1 / 6, 1 / 4][hazards.spikes];
  }
  return frac;
}

interface Context {
  state: BattleState;
  table: CalcTable;
  field: FieldContext;
}

/** The Q3 static rank of one bench mon as a switch-in vs the current opposing active. */
function switchScore(ctx: Context, side: 0 | 1, bench: MonState): number {
  const mySide = ctx.state.sides[side];
  const theirSide = ctx.state.sides[1 - side];
  const opposing = theirSide.mons[theirSide.activeIndex];
  if (!opposing || opposing.fainted) return 0;

  const outgoing =
    threat(ctx.table, side, bench, opposing, theirSide, ctx.field) *
    (raceSpeed(bench, mySide) > raceSpeed(opposing, theirSide) ? 1 : WEIGHTS.SLOWER_DISCOUNT);
  // Incoming factor 1, not the slower discount: a switch-in always eats the hit.
  const incoming = threat(ctx.table, (1 - side) as 0 | 1, opposing, bench, mySide, ctx.field);
  return WEIGHTS.MATCHUP * (outgoing - incoming) - 100 * hazardFrac(ctx.table.gen, bench, mySide.hazards);
}

/** Static rank of staying in with the current active. */
function stayScore(ctx: Context, side: 0 | 1): number {
  const mySide = ctx.state.sides[side];
  const theirSide = ctx.state.sides[1 - side];
  const mine = mySide.mons[mySide.activeIndex];
  const theirs = theirSide.mons[theirSide.activeIndex];
  if (!mine || !theirs || mine.fainted || theirs.fainted) return 0;

  const myFactor =
    raceSpeed(mine, mySide) > raceSpeed(theirs, theirSide) ? 1 : WEIGHTS.SLOWER_DISCOUNT;
  return (
    WEIGHTS.MATCHUP *
    (threat(ctx.table, side, mine, theirs, theirSide, ctx.field) * myFactor -
      threat(ctx.table, (1 - side) as 0 | 1, theirs, mine, mySide, ctx.field))
  );
}

/** MonState for the mon a switch action brings in (slot is 1-based team position). */
function benchMon(state: BattleState, side: 0 | 1, action: Action): MonState | undefined {
  if (action.kind !== 'switch') return undefined;
  return state.sides[side].mons[action.slot - 1];
}

/**
 * Reduction in the opponent's current best incoming threat against `atk` if
 * `atk` terastallizes right now (same koProb+chip units as moveThreat's
 * damaging-move branch, via the same `threat()` helper `switchScore`/
 * `stayScore` already use with reversed attacker/defender roles). Ranking-
 * only: this never touches the eval, only which candidates get simulated.
 */
function teraDefensiveValue(ctx: Context, side: 0 | 1, atk: MonState): number {
  const theirSide = ctx.state.sides[1 - side];
  const theirActive = theirSide.mons[theirSide.activeIndex];
  if (!theirActive || theirActive.fainted) return 0;
  const mySide = ctx.state.sides[side];
  const without = threat(ctx.table, (1 - side) as 0 | 1, theirActive, atk, mySide, ctx.field);
  const withTera = threat(ctx.table, (1 - side) as 0 | 1, theirActive, {...atk, terastallized: true}, mySide, ctx.field);
  return Math.max(0, without - withTera);
}

/** Threat score of one specific move (for move ranking / tera selection). */
function moveThreat(
  ctx: Context,
  side: 0 | 1,
  atk: MonState,
  moveIndex: number,
  tera: boolean,
  cfg: SearchConfig
): number {
  const theirSide = ctx.state.sides[1 - side];
  const def = theirSide.mons[theirSide.activeIndex];
  if (!def || def.fainted) return 0;
  const attacker = tera ? {...atk, terastallized: true} : atk;
  const entry = getEntry(ctx.table, side, attacker, moveIndex, def);
  if (!entry) return 0;
  if (entry.category === 'Status') {
    // Status moves rank by their valued effect (burn/para/toxic/hazards/
    // setup) instead of a flat 0 — un-blinds interior candidate selection.
    const base = weightedStatusMoveValue(ctx.table, side, attacker, atk.moveIds[moveIndex], def, theirSide);
    if (!tera) return base;
    // Offense-only ranking structurally starves a "Tera to survive, then
    // set up/heal/Protect" line: a status move's own moveThreat is small,
    // so it never wins a rootTeraVariants slot against a decent attack even
    // when terastallizing would flip a lethal incoming hit into a survived
    // one. This is ranking-only — once a candidate is kept, its real
    // defensive payoff is already correctly scored by the actual sim
    // transition + evaluate(); this just lets it compete for a slot.
    const defense = teraDefensiveValue(ctx, side, atk);
    return base + (defense >= cfg.teraDefenseThreshold ? cfg.teraDefenseWeight * defense : 0);
  }
  return (
    koProb(entry, attacker, def, theirSide, ctx.field) +
    WEIGHTS.CHIP_WEIGHT * Math.min(1, modifiedFrac(entry, attacker, def, theirSide, ctx.field))
  );
}

function pruneSwitches(
  ctx: Context,
  side: 0 | 1,
  actions: Action[],
  cfg: SearchConfig,
  forced: boolean
): Action[] {
  const switches = actions.filter(a => a.kind === 'switch');
  if (forced || switches.length === 0) return switches;

  const stay = stayScore(ctx, side);
  const mySide = ctx.state.sides[side];
  const scored = switches
    .map(action => {
      const mon = benchMon(ctx.state, side, action)!;
      return {action, mon, score: switchScore(ctx, side, mon)};
    })
    // Dies on entry -> never worth an unforced exploration slot.
    .filter(({mon}) => hazardFrac(ctx.table.gen, mon, mySide.hazards) < mon.hp / mon.maxhp)
    .filter(({score}) => score > stay - cfg.switchMargin)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, cfg.rootSwitchK).map(s => s.action);
}

/**
 * Root candidate actions for one side: all non-disabled moves, tera
 * variants of the top-`rootTeraVariants` moves ranked by tera-slice threat,
 * plus the top-K pruned switches (search spec §4).
 */
export function rootCandidates(
  battle: Battle,
  side: 0 | 1,
  state: BattleState,
  table: CalcTable,
  cfg: SearchConfig
): Action[] {
  const legal = legalActions(battle, side);
  if (legal.length === 1) return legal; // pass, or single forced option

  const ctx: Context = {state, table, field: {weather: state.weather}};
  const forced = legal.every(a => a.kind === 'switch');
  if (forced) return legal;

  const mySide = state.sides[side];
  const active = mySide.mons[mySide.activeIndex];

  const plainMoves = legal.filter(a => a.kind === 'move' && !a.tera);
  const teraMoves = legal.filter(a => a.kind === 'move' && a.tera);

  let keptTera: Action[] = [];
  if (teraMoves.length && active) {
    keptTera = teraMoves
      .map(action => ({
        action,
        score: moveThreat(ctx, side, active, (action as {slot: number}).slot - 1, true, cfg),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, cfg.rootTeraVariants)
      .map(s => s.action);
  }

  return [...plainMoves, ...keptTera, ...pruneSwitches(ctx, side, legal, cfg, false)];
}

/**
 * Interior (d2) candidates: top-m statically ranked actions. Never
 * includes Tera variants — Tera branches at the root only (spec §4); a
 * held Tera at a leaf is scored by the eval's TERA_AVAILABLE bonus.
 */
export function interiorCandidates(
  battle: Battle,
  side: 0 | 1,
  state: BattleState,
  table: CalcTable,
  cfg: SearchConfig
): Action[] {
  const legal = legalActions(battle, side).filter(a => !(a.kind === 'move' && a.tera));
  if (legal.length <= 1) return legal;

  const ctx: Context = {state, table, field: {weather: state.weather}};
  const forced = legal.every(a => a.kind === 'switch');
  const mySide = state.sides[side];
  const active = mySide.mons[mySide.activeIndex];

  const scored = legal.map(action => {
    let score: number;
    if (action.kind === 'move') {
      score = active ? WEIGHTS.MATCHUP * moveThreat(ctx, side, active, action.slot - 1, false, cfg) : 0;
    } else if (action.kind === 'switch') {
      const mon = benchMon(state, side, action)!;
      score = switchScore(ctx, side, mon) - (forced ? 0 : cfg.switchMargin);
    } else {
      score = 0;
    }
    return {action, score};
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, cfg.interiorCandidates)
    .map(s => s.action);
}
