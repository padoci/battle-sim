import type {Generation} from '@pkmn/data';
import type {PokemonSet} from '../data/types';
import type {CalcTable} from '../engine/calc/table';
import type {MatchupAggregate} from './stats';
import {bestAnswer, bestThreat, buildPairingContext, threatFacts, type PairingContext, type ThreatFact} from './threats';

/**
 * Game-plan generation (ui-spec §6c): "calc does the thinking" — every fact
 * here is computed, never guessed. The renderer returns SENTENCES AS AN
 * ARRAY plus the raw facts: that contract is the seam a future on-device
 * polish layer (Nano/BYOK) wraps — it may rephrase each sentence, never
 * invent new ones. Do not collapse this to a single string.
 */
export interface GamePlanFacts {
  lead?: {yourSpecies: string; pressures: string};
  preserve?: {yourSpecies: string; checks: string};
  clock?: {kind: 'weather' | 'hazards'; label: string};
  biggestThreat?: ThreatFact;
}

export interface GamePlan {
  sentences: string[];
  facts: GamePlanFacts;
}

/** Derive plan facts for one matchup from the calc table + aggregate. */
export function deriveGamePlanFacts(
  gen: Generation,
  userTeam: PokemonSet[],
  opponentTeam: PokemonSet[],
  table: CalcTable,
  matchup: MatchupAggregate
): GamePlanFacts {
  const ctx: PairingContext = buildPairingContext(gen, userTeam, opponentTeam, table);
  const facts: GamePlanFacts = {};
  const oppMons = ctx.state.sides[1].mons;

  // Biggest opposing threat: prefer the mon that "does the most work" in
  // the sim data; fall back to the calc's scariest.
  const workhorse = matchup.mostWork[0]
    ? oppMons.find(m => m.speciesId === matchup.mostWork[0].speciesId)
    : undefined;
  const threatSource = workhorse ?? oppMons[0];
  if (threatSource) {
    facts.biggestThreat = threatFacts(ctx, threatSource).at(-1);
  }

  // Preserve: your best answer to that threat.
  if (threatSource) {
    const answer = bestAnswer(ctx, threatSource);
    if (answer) {
      facts.preserve = {
        yourSpecies: answer.species,
        checks: ctx.table.gen.species.get(threatSource.speciesId)?.name ?? threatSource.speciesId,
      };
    }
  }

  // Lead: your mon with the best expected damage into their likely lead
  // (their slot-1 mon), excluding the mon we're preserving.
  const theirLead = oppMons[0];
  if (theirLead) {
    let best: {species: string; expected: number} | undefined;
    for (const mine of ctx.state.sides[0].mons) {
      const mineName = ctx.table.gen.species.get(mine.speciesId)?.name ?? mine.speciesId;
      if (facts.preserve && mineName === facts.preserve.yourSpecies) continue;
      const threat = bestThreat(ctx, 0, mine, theirLead);
      if (threat && (!best || threat.expectedFrac > best.expected)) {
        best = {species: mineName, expected: threat.expectedFrac};
      }
    }
    if (best) {
      facts.lead = {
        yourSpecies: best.species,
        pressures: ctx.table.gen.species.get(theirLead.speciesId)?.name ?? theirLead.speciesId,
      };
    }
  }

  // Clock: their weather archetype or heavy hazard presence puts you on a timer.
  if (matchup.archetype.features.weatherSetter) {
    facts.clock = {kind: 'weather', label: matchup.archetype.label.toLowerCase()};
  }

  return facts;
}

/** Template spine (§6c): deterministic sentences from verified facts. */
export function renderGamePlan(facts: GamePlanFacts): GamePlan {
  const sentences: string[] = [];
  if (facts.lead) {
    sentences.push(`Lead ${facts.lead.yourSpecies} to pressure ${facts.lead.pressures}.`);
  }
  if (facts.preserve) {
    sentences.push(
      `Preserve ${facts.preserve.yourSpecies} as your check to ${facts.preserve.checks}.`
    );
  }
  if (facts.biggestThreat?.kind === 'outspeeds-team') {
    sentences.push(
      `${facts.biggestThreat.attackerSpecies} outspeeds your whole team — keep it pressured or revenge-kill it early.`
    );
  } else if (facts.biggestThreat?.targetSpecies && facts.biggestThreat.moveName) {
    sentences.push(
      `Watch ${facts.biggestThreat.attackerSpecies}'s ${facts.biggestThreat.moveName} into ${facts.biggestThreat.targetSpecies} — don't let that trade happen for free.`
    );
  }
  if (facts.clock) {
    sentences.push(`You're on a clock vs their ${facts.clock.label} — don't let the game go long.`);
  }
  if (!sentences.length) {
    sentences.push('No single defining threat — play the matchup on tempo and preserve your win condition.');
  }
  return {sentences, facts};
}
