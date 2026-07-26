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
    /** Faints attributed to hazards/residual chip rather than a direct move. */
    chipFaints: number;
  }>;
  /** Opposing mons ranked by damage output across the matchup. */
  mostWork: Array<{speciesId: string; totalDamageFrac: number}>;
  /** Fraction of decisions where YOUR active was faster. */
  speedRaceWinRate: number;
  /** How many speed comparisons that rate is based on (sample-size gate). */
  raceDecisions: number;
  /** Your mons ranked by damage output in games you won. */
  carriedBy: Array<{speciesId: string; damageFracInWins: number}>;
  /** Your mons ranked by damage output across ALL games (wins and losses). */
  dealtBy: Array<{speciesId: string; totalDamageFrac: number}>;
  /** Your mons by opponent KOs they scored (cause of a side-1 faint). */
  kosScored: Array<{speciesId: string; count: number}>;
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

  const faintAgg = new Map<string, {turns: number[]; causes: Map<string, number>; chip: number}>();
  const oppDamage = new Map<string, number>();
  const winDamage = new Map<string, number>();
  const allDamage = new Map<string, number>();
  const koAgg = new Map<string, number>();
  let fasterDecisions = 0;
  let raceDecisions = 0;

  for (const battle of battles) {
    const stats = battle.result.stats;
    if (!stats) continue;

    for (const faint of stats.faints) {
      if (faint.side !== 0) {
        // An opposing faint caused by one of your mons is a KO scored.
        if (faint.causeSpeciesId && faint.causeKind === 'move') {
          koAgg.set(faint.causeSpeciesId, (koAgg.get(faint.causeSpeciesId) ?? 0) + 1);
        }
        continue;
      }
      let entry = faintAgg.get(faint.speciesId);
      if (!entry) {
        entry = {turns: [], causes: new Map(), chip: 0};
        faintAgg.set(faint.speciesId, entry);
      }
      entry.turns.push(faint.turn);
      if (faint.causeKind === 'hazard' || faint.causeKind === 'residual') entry.chip++;
      if (faint.causeSpeciesId) {
        entry.causes.set(faint.causeSpeciesId, (entry.causes.get(faint.causeSpeciesId) ?? 0) + 1);
      }
    }

    for (const [species, frac] of Object.entries(stats.damageDealtFrac[1])) {
      oppDamage.set(species, (oppDamage.get(species) ?? 0) + frac);
    }
    for (const [species, frac] of Object.entries(stats.damageDealtFrac[0])) {
      allDamage.set(species, (allDamage.get(species) ?? 0) + frac);
      if (battle.result.winner === 0) {
        winDamage.set(species, (winDamage.get(species) ?? 0) + frac);
      }
    }

    fasterDecisions += stats.speedRace.fasterCounts[0];
    raceDecisions +=
      stats.speedRace.fasterCounts[0] + stats.speedRace.fasterCounts[1] + stats.speedRace.ties;
  }

  const earliestFaints = [...faintAgg.entries()]
    .map(([speciesId, {turns, causes, chip}]) => ({
      speciesId,
      faintCount: turns.length,
      meanTurn: turns.reduce((a, b) => a + b, 0) / turns.length,
      topCause: [...causes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
      chipFaints: chip,
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
    raceDecisions,
    carriedBy: byDamage(winDamage).map(([speciesId, damageFracInWins]) => ({speciesId, damageFracInWins})),
    dealtBy: byDamage(allDamage).map(([speciesId, totalDamageFrac]) => ({speciesId, totalDamageFrac})),
    kosScored: [...koAgg.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([speciesId, count]) => ({speciesId, count})),
  };
}

/** Roll matchups up into archetype cards, sorted worst-first. */
/** W-L-D for a card: the card only carries wins/battles, so sum its matchups. */
export function cardRecord(card: ArchetypeCard): {wins: number; losses: number; draws: number} {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const m of card.matchups) {
    wins += m.wins;
    losses += m.losses;
    draws += m.draws;
  }
  return {wins, losses, draws};
}

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
  /** True while the sample is too thin to name a band — the headline is a
   *  progress read, not a judgement. */
  provisional: boolean;
}

/**
 * Battles before the headline will call the team anything.
 *
 * Matches the threshold the "what to change" reads already wait for, and for
 * the same reason. The page is otherwise careful — thin-sample chips, a ±
 * interval beside every rate, "direction, not gospel" — but the largest text
 * on it used to commit from the first battle: one win read "Strong overall,
 * no glaring archetype hole" at ±40%, and the same team settled at
 * "Struggling" thirty battles later.
 */
export const MIN_VERDICT_BATTLES = 25;

/**
 * Band the rate in 5% steps rather than off the raw value.
 *
 * The bands are 15 points wide and a run walks its win rate across them one
 * battle at a time, so a rate sitting near a boundary used to re-label on
 * almost every battle: observed flipping Solid -> Struggling -> Solid ->
 * Struggling on adjacent battles around 50%. Snapping costs nothing real —
 * the interval is far wider than 5% at any sample this side of hundreds — and
 * it stops the headline contradicting itself while you watch.
 */
function band(winRate: number): string {
  const snapped = Math.round(winRate * 20) / 20;
  if (snapped >= 0.65) return 'Strong overall';
  if (snapped >= 0.5) return 'Solid';
  if (snapped >= 0.35) return 'Struggling';
  return 'Rough';
}

export function summarize(cards: ArchetypeCard[], matchups: MatchupAggregate[]): OverallSummary {
  const battles = matchups.reduce((sum, m) => sum + m.battles, 0);
  const wins = matchups.reduce((sum, m) => sum + m.wins, 0);
  const losses = matchups.reduce((sum, m) => sum + m.losses, 0);
  const draws = battles - wins - losses;
  const winRate = battles ? wins / battles : 0;

  const worst = cards[0];
  const speedTrouble = matchups.length
    ? matchups.reduce((sum, m) => sum + m.speedRaceWinRate * m.battles, 0) / Math.max(1, battles) < 0.4
    : false;
  const weakness = worst && worst.winRate < 0.45
    ? `leans fragile to ${worst.label}`
    : speedTrouble
      ? 'leans fragile to speed control'
      : 'no glaring archetype hole';

  // Under the threshold the headline reports progress instead of a verdict.
  //
  // What survives the gate is the weakness, and only when something was
  // actually seen losing: "the worst thing so far" is a true statement about
  // any sample. The all-clear is not — "no glaring archetype hole" is a claim
  // that nothing is there, which is precisely what a thin sample cannot
  // support, so it waits with the band.
  const provisional = battles < MIN_VERDICT_BATTLES;
  const observed = weakness === 'no glaring archetype hole' ? undefined : weakness;
  const verdict = provisional
    ? `Still sampling — ${Math.round(winRate * 100)}% over ${battles} battle${battles === 1 ? '' : 's'}` +
      `${observed ? `, ${observed}` : ''} so far`
    : `${band(winRate)}, ${weakness}`;

  return {battles, wins, losses, draws, winRate, verdict, provisional};
}
