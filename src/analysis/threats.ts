import type {Generation} from '@pkmn/data';
import type {PokemonSet} from '../data/types';
import {createBattle} from '../engine/battle';
import {getEntry, type CalcTable, type DamageEntry} from '../engine/calc/table';
import {damageScalar, type FieldContext} from '../engine/calc/modifiers';
import {fasterSide, raceSpeed} from '../engine/eval';
import {extractState, type BattleState, type MonState, type SideState} from '../engine/snapshot';

/**
 * Fact-returning matchup explainers for the dashboard/game plans. The
 * eval's `threat()` folds everything into one scalar for search arithmetic;
 * these return the decomposed facts ("which move, what range, who's faster")
 * that prose and evidence blocks need (ui-spec §6b/§6c).
 */

export interface BestThreat {
  moveId: string;
  moveName: string;
  koProb: number;
  /** Base rolls as fractions of the defender's max HP: [min, max]. */
  fracRange: [number, number];
  expectedFrac: number;
  /** 1 = OHKO range, 2 = 2HKO, 3 = 3HKO+, 0 = no damage. */
  koTurns: number;
}

export interface ThreatFact {
  kind: 'outspeeds-team' | 'ohko' | '2hko' | 'chip-only' | 'no-damage';
  attackerSpecies: string;
  /** The defender this fact is about (your most-threatened relevant mon). */
  targetSpecies?: string;
  moveName?: string;
  outspeedsCount?: number;
  koProb?: number;
  fracRange?: [number, number];
  /** Pre-formatted mono evidence line ("checks the working"). */
  evidence: string;
}

/**
 * Neutral-state pairing context: both full teams as MonStates plus the calc
 * table — everything threat queries need, no battles required.
 */
export interface PairingContext {
  table: CalcTable;
  state: BattleState;
  field: FieldContext;
}

/**
 * Build the neutral-state context for (userTeam, opponentTeam): a battle is
 * created and immediately snapshotted (real computed stats, zero turns
 * played), reusing the exact tested engine path.
 */
export function buildPairingContext(
  _gen: Generation,
  userTeam: PokemonSet[],
  opponentTeam: PokemonSet[],
  table: CalcTable
): PairingContext {
  const battle = createBattle({
    p1: {team: userTeam},
    p2: {team: opponentTeam},
    seed: '1,2,3,4' as never,
  });
  const state = extractState(battle);
  return {table, state, field: {weather: ''}};
}

const pct = (frac: number) => `${(frac * 100).toFixed(1)}%`;

/** The attacker's best damaging move vs one defender, decomposed. */
export function bestThreat(
  ctx: PairingContext,
  atkSide: 0 | 1,
  atk: MonState,
  def: MonState
): BestThreat | undefined {
  const defSide = ctx.state.sides[1 - atkSide] as SideState;
  let best: {entry: DamageEntry; moveId: string} | undefined;
  let bestExpected = 0;

  for (let m = 0; m < atk.moveIds.length; m++) {
    const entry = getEntry(ctx.table, atkSide, atk, m, def);
    if (!entry || entry.category === 'Status' || !entry.rolls.length) continue;
    const scalar = damageScalar(entry, atk, def, defSide, ctx.field);
    const expected = entry.expected * scalar;
    if (expected > bestExpected) {
      bestExpected = expected;
      best = {entry, moveId: atk.moveIds[m]};
    }
  }
  if (!best) return undefined;

  const {entry, moveId} = best;
  const minFrac = entry.rolls[0] / def.maxhp;
  const maxFrac = entry.rolls[entry.rolls.length - 1] / def.maxhp;
  const koProb = entry.rolls.filter(r => r >= def.maxhp).length / entry.rolls.length;
  // Guaranteed hits to KO from full HP (min roll): 1 = guaranteed OHKO range.
  const koTurns = minFrac <= 0 ? 0 : Math.ceil(1 / minFrac);
  const moveName = ctx.table.gen.moves.get(moveId)?.name ?? moveId;
  return {
    moveId,
    moveName,
    koProb,
    fracRange: [minFrac, maxFrac],
    expectedFrac: entry.expectedFrac,
    koTurns,
  };
}

/** Species display name via the table's gen. */
function displayName(ctx: PairingContext, speciesId: string): string {
  return ctx.table.gen.species.get(speciesId)?.name ?? speciesId;
}

/**
 * Threat facts one opposing mon generates against your whole team:
 * speed dominance plus its single scariest damage threat.
 */
export function threatFacts(ctx: PairingContext, opposingMon: MonState): ThreatFact[] {
  const facts: ThreatFact[] = [];
  const myMons = ctx.state.sides[0].mons.filter(m => !m.fainted);
  const oppSide = ctx.state.sides[1];
  const attacker = displayName(ctx, opposingMon.speciesId);

  // Speed dominance.
  const outsped = myMons.filter(
    m => raceSpeed(opposingMon, oppSide) > raceSpeed(m, ctx.state.sides[0])
  ).length;
  if (outsped === myMons.length && myMons.length > 0) {
    facts.push({
      kind: 'outspeeds-team',
      attackerSpecies: attacker,
      outspeedsCount: outsped,
      evidence: `${attacker} outspeeds all ${outsped} of your team (${opposingMon.spe} Spe)`,
    });
  }

  // Scariest single damage threat across your team.
  let scariest: {threat: BestThreat; target: MonState} | undefined;
  for (const mine of myMons) {
    const threat = bestThreat(ctx, 1, opposingMon, mine);
    if (!threat) continue;
    if (!scariest || threat.fracRange[0] > scariest.threat.fracRange[0]) {
      scariest = {threat, target: mine};
    }
  }
  if (scariest) {
    const {threat, target} = scariest;
    const targetName = displayName(ctx, target.speciesId);
    const range = `${pct(threat.fracRange[0])}–${pct(threat.fracRange[1])}`;
    const kind: ThreatFact['kind'] =
      threat.koProb > 0 ? 'ohko' : threat.fracRange[0] >= 0.5 ? '2hko' : 'chip-only';
    const verdict =
      kind === 'ohko'
        ? threat.koProb === 1
          ? 'guaranteed OHKO'
          : `${Math.round(threat.koProb * 100)}% chance to OHKO`
        : kind === '2hko'
          ? '2HKO'
          : 'chip only';
    facts.push({
      kind,
      attackerSpecies: attacker,
      targetSpecies: targetName,
      moveName: threat.moveName,
      koProb: threat.koProb,
      fracRange: threat.fracRange,
      evidence: `${attacker} ${threat.moveName} vs ${targetName}: ${range} (${verdict})`,
    });
  }

  return facts;
}

/** Which of your mons best answers one opposing mon (for game plans). */
export function bestAnswer(
  ctx: PairingContext,
  opposingMon: MonState
): {speciesId: string; species: string; incoming: number; outgoing: number} | undefined {
  let best: {speciesId: string; incoming: number; outgoing: number} | undefined;
  for (const mine of ctx.state.sides[0].mons) {
    if (mine.fainted) continue;
    const incoming = bestThreat(ctx, 1, opposingMon, mine)?.fracRange[0] ?? 0;
    const outgoing = bestThreat(ctx, 0, mine, opposingMon)?.expectedFrac ?? 0;
    const score = outgoing - incoming;
    const bestScore = best ? best.outgoing - best.incoming : -Infinity;
    if (score > bestScore) best = {speciesId: mine.speciesId, incoming, outgoing};
  }
  if (!best) return undefined;
  return {...best, species: displayName(ctx, best.speciesId)};
}

export {fasterSide};
