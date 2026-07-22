import type {Generation} from '@pkmn/data';
import type {PokemonSet} from '../data/types';
import {buildCalcTable} from '../engine/calc/table';
import type {BattleResult} from '../search/runner';
import {classifyTeam} from './archetype';
import {aggregateMatchup} from './stats';
import {calcSuggestions} from './suggestions';
import {buildPairingContext, threatFacts} from './threats';

/**
 * Run post-mortem for "Can you 6-0?" (ui-spec §6a): one or two crisp reads
 * on what ended (or defined) the run, with expandable calc evidence. Reuses
 * the analysis FACT layer (threatFacts / aggregateMatchup), not the
 * forward-looking game-plan renderer.
 */
export interface PostMortemRead {
  sentence: string;
  /** Mono evidence lines ("show the working"). */
  evidence: string[];
}

export interface PostMortem {
  headline: string;
  record: string;
  reads: PostMortemRead[];
}

export interface PlayedBattle {
  opponentIndex: number;
  result: BattleResult;
}

function speciesName(gen: Generation, id: string): string {
  return gen.species.get(id)?.name ?? id;
}

function eliminatedReads(
  gen: Generation,
  userTeam: PokemonSet[],
  opponent: {name: string; sets: PokemonSet[]},
  losingBattle: PlayedBattle
): PostMortemRead[] {
  const reads: PostMortemRead[] = [];
  const matchup = aggregateMatchup(
    `gauntlet-${losingBattle.opponentIndex}`,
    opponent.name,
    classifyTeam(gen, opponent.sets),
    [{teamId: 'g', result: losingBattle.result}]
  );

  const table = buildCalcTable(gen, [userTeam, opponent.sets]);
  const ctx = buildPairingContext(gen, userTeam, opponent.sets, table);

  // Read 1: the opposing workhorse that did the damage.
  const workhorseId = matchup.mostWork[0]?.speciesId;
  const workhorse = workhorseId
    ? ctx.state.sides[1].mons.find(m => m.speciesId === workhorseId)
    : undefined;
  if (workhorse) {
    const facts = threatFacts(ctx, workhorse);
    const name = speciesName(gen, workhorse.speciesId);
    const scariest = facts.at(-1);
    const speedFact = facts.find(f => f.kind === 'outspeeds-team');
    const sentence = speedFact
      ? `${name} ran the game: it outspeeds your whole team and nothing traded back.`
      : scariest?.targetSpecies
        ? `Nothing on your team switches into ${name}: ${scariest.moveName} into ${scariest.targetSpecies} decided it.`
        : `${name} did the heavy lifting for ${opponent.name}.`;
    const evidence = facts.map(f => f.evidence);
    if (matchup.speedRaceWinRate < 0.35) {
      evidence.push(`you won the speed race only ${Math.round(matchup.speedRaceWinRate * 100)}% of turns`);
    }
    reads.push({sentence, evidence});
  }

  // Read 2: your earliest faint.
  const faint = matchup.earliestFaints[0];
  if (faint) {
    const monName = speciesName(gen, faint.speciesId);
    const cause = faint.topCause ? ` to ${speciesName(gen, faint.topCause)}` : '';
    reads.push({
      sentence: `${monName} went down first (turn ~${Math.round(faint.meanTurn)}${cause}): the hole opened early.`,
      evidence: [
        `${monName}: fainted turn ${Math.round(faint.meanTurn)}${cause}`,
        ...matchup.mostWork.slice(0, 3).map(w => `${speciesName(gen, w.speciesId)} dealt ${Math.round(w.totalDamageFrac * 100)}% total HP`),
      ],
    });
  }

  // Prescriptive follow-ups: calc-backed "what to change" reads against the
  // team that ended the run (sample-size-free — pure pairing math).
  const prescriptive = calcSuggestions(ctx, matchup)
    .slice(0, 2)
    .map(s => ({sentence: s.sentence, evidence: s.evidence}));

  return [...reads.slice(0, 2), ...prescriptive];
}

function flawlessReads(gen: Generation, battles: PlayedBattle[]): PostMortemRead[] {
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

  const reads: PostMortemRead[] = [];
  if (mvp && totalDamage > 0) {
    reads.push({
      sentence: `${speciesName(gen, mvp[0])} carried the run: ${Math.round((mvp[1] / totalDamage) * 100)}% of all damage dealt.`,
      evidence: [...damage.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([id, frac]) => `${speciesName(gen, id)}: ${Math.round(frac * 100)}% total HP dealt across 6 games`),
    });
  }
  if (weakest && weakest[1] >= 2) {
    reads.push({
      sentence: `${speciesName(gen, weakest[0])} fainted in ${weakest[1]} of 6 games: the next field might punish that.`,
      evidence: [...faintCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id, count]) => `${speciesName(gen, id)}: fainted in ${count} game${count === 1 ? '' : 's'}`),
    });
  }
  return reads.slice(0, 2);
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
    return {headline: 'Flawless.', record: '6–0', reads: flawlessReads(gen, battles)};
  }

  const last = battles[battles.length - 1];
  const opponent = opponents[last.opponentIndex];
  const stalled = last.result.winner === null;
  return {
    headline: stalled
      ? `Stalled out in game ${battles.length} vs ${opponent.name}.`
      : `Eliminated in game ${battles.length} by ${opponent.name}.`,
    record,
    reads: eliminatedReads(gen, userTeam, opponent, last),
  };
}
