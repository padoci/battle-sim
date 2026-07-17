import type {BattleResult} from '../search/runner';
import type {ArchetypeId, ArchetypeResult} from './archetype';
import type {ThreatFact} from './threats';
import type {GamePlan} from './gameplan';

/** One completed battle plus which pool opponent it was against. */
export interface RecordedBattle {
  teamId: string;
  result: BattleResult;
}

/** Aggregate read over N battles vs ONE opponent team (ui-spec §6c). */
export interface MatchupAggregate {
  teamId: string;
  teamName: string;
  archetype: ArchetypeResult;
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  /** Your mons ranked by how early they tend to faint. */
  earliestFaints: Array<{
    speciesId: string;
    faintCount: number;
    meanTurn: number;
    topCause?: string;
  }>;
  /** Opposing mons ranked by damage output across the matchup. */
  mostWork: Array<{speciesId: string; totalDamageFrac: number}>;
  /** Fraction of decisions where YOUR active was faster. */
  speedRaceWinRate: number;
  /** Your mons ranked by damage output in games you won. */
  carriedBy: Array<{speciesId: string; damageFracInWins: number}>;
}

/** Archetype-level rollup card (the dashboard's unit of display, §6b). */
export interface ArchetypeCard {
  archetype: ArchetypeId;
  label: string;
  battles: number;
  wins: number;
  winRate: number;
  /** How many DISTINCT opponent teams drive this card (10-team-pool honesty). */
  distinctOpponents: number;
  matchups: MatchupAggregate[];
  threats: ThreatFact[];
  gamePlan?: GamePlan;
}

/** Mine one opponent's batch of results into a MatchupAggregate. */
export function aggregateMatchup(
  teamId: string,
  teamName: string,
  archetype: ArchetypeResult,
  battles: RecordedBattle[]
): MatchupAggregate {
  const wins = battles.filter(b => b.result.winner === 0).length;
  const losses = battles.filter(b => b.result.winner === 1).length;
  const draws = battles.length - wins - losses;

  const faintAgg = new Map<string, {turns: number[]; causes: Map<string, number>}>();
  const oppDamage = new Map<string, number>();
  const winDamage = new Map<string, number>();
  let fasterDecisions = 0;
  let raceDecisions = 0;

  for (const battle of battles) {
    const stats = battle.result.stats;
    if (!stats) continue;

    for (const faint of stats.faints) {
      if (faint.side !== 0) continue;
      let entry = faintAgg.get(faint.speciesId);
      if (!entry) {
        entry = {turns: [], causes: new Map()};
        faintAgg.set(faint.speciesId, entry);
      }
      entry.turns.push(faint.turn);
      if (faint.causeSpeciesId) {
        entry.causes.set(faint.causeSpeciesId, (entry.causes.get(faint.causeSpeciesId) ?? 0) + 1);
      }
    }

    for (const [species, frac] of Object.entries(stats.damageDealtFrac[1])) {
      oppDamage.set(species, (oppDamage.get(species) ?? 0) + frac);
    }
    if (battle.result.winner === 0) {
      for (const [species, frac] of Object.entries(stats.damageDealtFrac[0])) {
        winDamage.set(species, (winDamage.get(species) ?? 0) + frac);
      }
    }

    fasterDecisions += stats.speedRace.fasterCounts[0];
    raceDecisions +=
      stats.speedRace.fasterCounts[0] + stats.speedRace.fasterCounts[1] + stats.speedRace.ties;
  }

  const earliestFaints = [...faintAgg.entries()]
    .map(([speciesId, {turns, causes}]) => ({
      speciesId,
      faintCount: turns.length,
      meanTurn: turns.reduce((a, b) => a + b, 0) / turns.length,
      topCause: [...causes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
    }))
    .sort((a, b) => a.meanTurn - b.meanTurn);

  const byDamage = (map: Map<string, number>) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]);

  return {
    teamId,
    teamName,
    archetype,
    battles: battles.length,
    wins,
    losses,
    draws,
    winRate: battles.length ? wins / battles.length : 0,
    earliestFaints,
    mostWork: byDamage(oppDamage).map(([speciesId, totalDamageFrac]) => ({speciesId, totalDamageFrac})),
    speedRaceWinRate: raceDecisions ? fasterDecisions / raceDecisions : 0,
    carriedBy: byDamage(winDamage).map(([speciesId, damageFracInWins]) => ({speciesId, damageFracInWins})),
  };
}

/** Roll matchups up into archetype cards, sorted worst-first. */
export function rollUpByArchetype(matchups: MatchupAggregate[]): ArchetypeCard[] {
  const groups = new Map<ArchetypeId, MatchupAggregate[]>();
  for (const matchup of matchups) {
    const key = matchup.archetype.primary;
    groups.set(key, [...(groups.get(key) ?? []), matchup]);
  }
  return [...groups.entries()]
    .map(([archetype, group]) => {
      const battles = group.reduce((sum, m) => sum + m.battles, 0);
      const wins = group.reduce((sum, m) => sum + m.wins, 0);
      return {
        archetype,
        label: group[0].archetype.label,
        battles,
        wins,
        winRate: battles ? wins / battles : 0,
        distinctOpponents: group.length,
        matchups: [...group].sort((a, b) => a.winRate - b.winRate),
        threats: [],
      };
    })
    .sort((a, b) => a.winRate - b.winRate);
}

/** Overall verdict inputs for the headline (§6b). */
export interface OverallSummary {
  battles: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  verdict: string;
}

export function summarize(cards: ArchetypeCard[], matchups: MatchupAggregate[]): OverallSummary {
  const battles = matchups.reduce((sum, m) => sum + m.battles, 0);
  const wins = matchups.reduce((sum, m) => sum + m.wins, 0);
  const losses = matchups.reduce((sum, m) => sum + m.losses, 0);
  const draws = battles - wins - losses;
  const winRate = battles ? wins / battles : 0;

  const worst = cards[0];
  const band =
    winRate >= 0.65 ? 'Strong overall' : winRate >= 0.5 ? 'Solid' : winRate >= 0.35 ? 'Struggling' : 'Rough';
  const speedTrouble = matchups.length
    ? matchups.reduce((sum, m) => sum + m.speedRaceWinRate * m.battles, 0) / Math.max(1, battles) < 0.4
    : false;
  const weakness = worst && worst.winRate < 0.45
    ? `leans fragile to ${worst.label}`
    : speedTrouble
      ? 'leans fragile to speed control'
      : 'no glaring archetype hole';
  return {battles, wins, losses, draws, winRate, verdict: `${band}, ${weakness}`};
}
