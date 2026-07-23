import type {Generation} from '@pkmn/data';
import type {PokemonSet} from '../data/types';
import {buildCalcTable} from '../engine/calc/table';
import type {BattleResult} from '../search/runner';
import {classifyTeam} from './archetype';
import {findBiggestHit, type BattleHighlight} from './highlights';
import {aggregateMatchup} from './stats';
import {buildPairingContext, threatFacts} from './threats';

/**
 * Run recap for "Can you 6-0?" (the fun cinematic gauntlet, not the Lab):
 * a few punchy, always-visible lines built from real battle facts (mined
 * damage/faint aggregates plus an actual biggest-hit/finishing-blow pulled
 * from the battle's own protocol log via highlights.ts). No expandable
 * "show the calc" evidence here on purpose — that tone belongs to Test
 * your team's analytical dashboard (suggestions.ts / ReadItem), not this
 * screen. Reuses the analysis FACT layer (threatFacts / aggregateMatchup),
 * not the forward-looking game-plan renderer.
 */
export interface PostMortem {
  headline: string;
  record: string;
  lines: string[];
}

export interface PlayedBattle {
  opponentIndex: number;
  result: BattleResult;
}

function speciesName(gen: Generation, id: string): string {
  return gen.species.get(id)?.name ?? id;
}

/** Parenthetical flourish shared by both hit sentences below. */
function hitFlourish(hit: BattleHighlight): string {
  const bits: string[] = [];
  if (hit.crit) bits.push('a critical hit');
  if (hit.superEffective) bits.push('super effective');
  return bits.length ? ` (${bits.join(', ')})` : '';
}

function finishingBlowSentence(hit: BattleHighlight): string {
  return `${hit.attackerSpecies}'s ${hit.move} sealed it${hitFlourish(hit)}: ${hit.pct}% and your last mon went down.`;
}

function biggestHitOfRunSentence(hit: BattleHighlight): string {
  return `The biggest hit of the run: ${hit.attackerSpecies}'s ${hit.move} took ${hit.pct}% off ${hit.defenderSpecies} in one shot${hitFlourish(hit)}.`;
}

function eliminatedRecap(
  gen: Generation,
  userTeam: PokemonSet[],
  opponent: {name: string; sets: PokemonSet[]},
  losingBattle: PlayedBattle
): string[] {
  const lines: string[] = [];
  const matchup = aggregateMatchup(
    `gauntlet-${losingBattle.opponentIndex}`,
    opponent.name,
    classifyTeam(gen, opponent.sets),
    [{teamId: 'g', result: losingBattle.result}]
  );

  // Line 1: the finishing blow, mined straight from this battle's own log.
  if (losingBattle.result.protocolLog) {
    const hit = findBiggestHit(losingBattle.result.protocolLog);
    if (hit) lines.push(finishingBlowSentence(hit));
  }

  // Line 2: the opposing workhorse that did the damage (kept — genuine
  // analysis, not filler — just reworded with some actual personality).
  const table = buildCalcTable(gen, [userTeam, opponent.sets]);
  const ctx = buildPairingContext(gen, userTeam, opponent.sets, table);
  const workhorseId = matchup.mostWork[0]?.speciesId;
  const workhorse = workhorseId
    ? ctx.state.sides[1].mons.find(m => m.speciesId === workhorseId)
    : undefined;
  if (workhorse) {
    const facts = threatFacts(ctx, workhorse);
    const name = speciesName(gen, workhorse.speciesId);
    const scariest = facts.at(-1);
    const speedFact = facts.find(f => f.kind === 'outspeeds-team');
    let sentence = speedFact
      ? `${name} was just too fast: it outran your whole team and never looked back.`
      : scariest?.targetSpecies
        ? `Nothing on your team wanted to see ${name}'s ${scariest.moveName}: it walked through ${scariest.targetSpecies} and decided the game.`
        : `${name} did the heavy lifting for ${opponent.name}.`;
    if (matchup.speedRaceWinRate < 0.35) {
      sentence += ` You only won the speed race ${Math.round(matchup.speedRaceWinRate * 100)}% of the time.`;
    }
    lines.push(sentence);
  }

  // Line 3: your earliest faint.
  const faint = matchup.earliestFaints[0];
  if (faint) {
    const monName = speciesName(gen, faint.speciesId);
    const cause = faint.topCause ? ` to ${speciesName(gen, faint.topCause)}` : '';
    lines.push(`${monName} was first to go down (turn ~${Math.round(faint.meanTurn)}${cause}): that's when things started slipping.`);
  }

  return lines.slice(0, 3);
}

function flawlessRecap(gen: Generation, battles: PlayedBattle[]): string[] {
  // Fold damage + faints across all six wins (stats-only, no calc needed).
  const damage = new Map<string, number>();
  const faintCounts = new Map<string, number>();
  for (const battle of battles) {
    const stats = battle.result.stats;
    if (!stats) continue;
    for (const [id, frac] of Object.entries(stats.damageDealtFrac[0])) {
      damage.set(id, (damage.get(id) ?? 0) + frac);
    }
    for (const faint of stats.faints) {
      if (faint.side === 0) faintCounts.set(faint.speciesId, (faintCounts.get(faint.speciesId) ?? 0) + 1);
    }
  }
  const totalDamage = [...damage.values()].reduce((a, b) => a + b, 0);
  const mvp = [...damage.entries()].sort((a, b) => b[1] - a[1])[0];
  const weakest = [...faintCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  const lines: string[] = [];
  if (mvp && totalDamage > 0) {
    lines.push(`${speciesName(gen, mvp[0])} was the real MVP: ${Math.round((mvp[1] / totalDamage) * 100)}% of the damage across all six wins.`);
  }

  // The single biggest hit across the whole run, mined from every battle's
  // own log (not just the folded aggregate — a real moment, not a stat).
  let bestHit: BattleHighlight | undefined;
  for (const battle of battles) {
    if (!battle.result.protocolLog) continue;
    const hit = findBiggestHit(battle.result.protocolLog);
    if (hit && (!bestHit || hit.pct > bestHit.pct)) bestHit = hit;
  }
  if (bestHit) lines.push(biggestHitOfRunSentence(bestHit));

  if (weakest && weakest[1] >= 2) {
    lines.push(`${speciesName(gen, weakest[0])} took the L in ${weakest[1]} of 6 games: the one shaky link in an otherwise flawless run.`);
  }
  return lines.slice(0, 3);
}

export function buildPostMortem(
  gen: Generation,
  userTeam: PokemonSet[],
  opponents: Array<{name: string; sets: PokemonSet[]}>,
  battles: PlayedBattle[],
  outcome: 'flawless' | 'eliminated'
): PostMortem {
  const wins = battles.filter(b => b.result.winner === 0).length;
  const losses = battles.length - wins;
  const record = `${wins}–${losses}`;

  if (outcome === 'flawless') {
    return {headline: 'Flawless.', record: '6–0', lines: flawlessRecap(gen, battles)};
  }

  const last = battles[battles.length - 1];
  const opponent = opponents[last.opponentIndex];
  const stalled = last.result.winner === null;
  return {
    headline: stalled
      ? `Stalled out in game ${battles.length} vs ${opponent.name}.`
      : `Eliminated in game ${battles.length} by ${opponent.name}.`,
    record,
    lines: eliminatedRecap(gen, userTeam, opponent, last),
  };
}
