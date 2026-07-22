import {gen9} from '../data/gen';
import type {PokemonSet} from '../data/types';
import {bestAnswer, bestThreat, type PairingContext} from './threats';
import type {ArchetypeCard, MatchupAggregate} from './stats';

/**
 * Prescriptive "what to change" reads, mined from the same aggregates and calc
 * primitives the descriptive dashboard already trusts. Each suggestion mirrors
 * PostMortemRead's {sentence, evidence[]} shape so the existing expandable
 * Read UI renders it unchanged.
 *
 * Every heuristic is thresholded with a minimum sample size so a 10-battle
 * gut-check doesn't fire confident advice. Tera-timing suggestions are future
 * work — they need a tera-turn stat that BattleStats doesn't record yet.
 */

export type SuggestionKind =
  | 'hazard-chip'
  | 'dead-weight'
  | 'no-answer'
  | 'speed-losing'
  | 'overreliance'
  | 'ko-drought'
  | 'unchecked-sweeper';

export interface Suggestion {
  kind: SuggestionKind;
  severity: 'high' | 'medium' | 'low';
  sentence: string;
  evidence: string[];
  /** The user's mon this is about (id form), when it targets a single slot. */
  targetSpeciesId?: string;
}

const SEVERITY_ORDER: Record<Suggestion['severity'], number> = {high: 0, medium: 1, low: 2};

const pct = (frac: number) => `${Math.round(frac * 100)}%`;

function name(speciesId: string): string {
  return gen9().species.get(speciesId)?.name ?? speciesId;
}

function toId(species: string): string {
  return gen9().species.get(species)?.id ?? species.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Sort by severity, drop duplicate (kind, target) pairs, cap the list. */
export function rankSuggestions(list: Suggestion[], cap = 5): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const s of [...list].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])) {
    const key = `${s.kind}|${s.targetSpeciesId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(0, cap);
}

interface FoldedMon {
  faintCount: number;
  chipFaints: number;
  turnSum: number;
  topCause?: string;
  dealt: number;
}

/** Fold a card's per-matchup aggregates into per-species totals. */
function foldCard(card: ArchetypeCard) {
  const mons = new Map<string, FoldedMon>();
  const kos = new Map<string, number>();
  let winDamageTotal = 0;
  const winDamageBy = new Map<string, number>();
  let raceDecisions = 0;
  let fasterDecisions = 0;

  for (const m of card.matchups) {
    for (const f of m.earliestFaints) {
      const entry = mons.get(f.speciesId) ?? {faintCount: 0, chipFaints: 0, turnSum: 0, dealt: 0};
      entry.faintCount += f.faintCount;
      entry.chipFaints += f.chipFaints;
      entry.turnSum += f.meanTurn * f.faintCount;
      entry.topCause = entry.topCause ?? f.topCause;
      mons.set(f.speciesId, entry);
    }
    for (const d of m.dealtBy) {
      const entry = mons.get(d.speciesId) ?? {faintCount: 0, chipFaints: 0, turnSum: 0, dealt: 0};
      entry.dealt += d.totalDamageFrac;
      mons.set(d.speciesId, entry);
    }
    for (const k of m.kosScored) kos.set(k.speciesId, (kos.get(k.speciesId) ?? 0) + k.count);
    for (const c of m.carriedBy) {
      winDamageTotal += c.damageFracInWins;
      winDamageBy.set(c.speciesId, (winDamageBy.get(c.speciesId) ?? 0) + c.damageFracInWins);
    }
    raceDecisions += m.raceDecisions;
    fasterDecisions += m.speedRaceWinRate * m.raceDecisions;
  }
  return {mons, kos, winDamageTotal, winDamageBy, raceDecisions, fasterDecisions};
}

/** Aggregate-driven suggestions for one archetype card (no calc needed). */
export function statSuggestions(card: ArchetypeCard, userTeam: PokemonSet[]): Suggestion[] {
  const out: Suggestion[] = [];
  const B = card.battles;
  if (B === 0) return out;
  const {mons, kos, winDamageTotal, winDamageBy, raceDecisions, fasterDecisions} = foldCard(card);

  for (const [speciesId, mon] of mons) {
    const meanTurn = mon.faintCount ? mon.turnSum / mon.faintCount : 0;

    // 1. hazard-chip: dies to hazards/residual, not to a mon.
    if (mon.faintCount >= 3 && mon.chipFaints / mon.faintCount >= 0.3) {
      out.push({
        kind: 'hazard-chip',
        severity: 'high',
        targetSpeciesId: speciesId,
        sentence: `${name(speciesId)} keeps dying to hazards/residual chip vs ${card.label} (${mon.chipFaints} of ${mon.faintCount} faints): consider Heavy-Duty Boots or dedicated hazard removal.`,
        evidence: [
          `${name(speciesId)}: ${mon.chipFaints}/${mon.faintCount} faints from chip damage over ${B} battles`,
        ],
      });
    }

    // 2. dead-weight: faints early and often while contributing little. The
    // faint-count floor (like hazard-chip's) keeps a live run-until-stopped
    // dashboard from branding a slot "the weakest" off one or two battles.
    if (mon.faintCount >= 3 && mon.faintCount >= 0.6 * B && meanTurn <= 6 && mon.dealt < 0.5) {
      out.push({
        kind: 'dead-weight',
        severity: 'high',
        targetSpeciesId: speciesId,
        sentence: `${name(speciesId)} faints in ${pct(mon.faintCount / B)} of battles vs ${card.label} (mean turn ${meanTurn.toFixed(1)}) while dealing under half a KO of damage: the weakest slot; consider replacing it.`,
        evidence: [
          `${name(speciesId)}: ${mon.faintCount} faints in ${B} battles, mean faint turn ${meanTurn.toFixed(1)}`,
          `total damage output ${pct(mon.dealt)} of one mon's HP across the matchup` +
            (mon.topCause ? ` · usually removed by ${name(mon.topCause)}` : ''),
        ],
      });
    }
  }

  // 4. speed-losing: consistently the slower side.
  if (raceDecisions >= 20 && fasterDecisions / raceDecisions < 0.4) {
    out.push({
      kind: 'speed-losing',
      severity: 'medium',
      sentence: `You win only ${pct(fasterDecisions / raceDecisions)} of speed interactions vs ${card.label}: consider more Speed investment, a Choice Scarf, or priority moves.`,
      evidence: [`faster in ${Math.round(fasterDecisions)} of ${raceDecisions} speed comparisons`],
    });
  }

  // 5. overreliance: wins lean on one mon.
  if (winDamageTotal > 0 && card.winRate < 0.65) {
    const [topId, topDamage] = [...winDamageBy.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = topDamage / winDamageTotal;
    if (share >= 0.4) {
      out.push({
        kind: 'overreliance',
        severity: 'medium',
        targetSpeciesId: topId,
        sentence: `Wins vs ${card.label} lean heavily on ${name(topId)} (${pct(share)} of winning damage): add a secondary win condition in case it goes down.`,
        evidence: [...winDamageBy.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([id, dmg]) => `${name(id)}: ${pct(dmg / winDamageTotal)} of winning damage`),
      });
    }
  }

  // 6. ko-drought: a slot that never scores a KO (only when KO data exists at
  // all — an empty map means stats weren't collected, not a passive team).
  const totalKos = [...kos.values()].reduce((a, b) => a + b, 0);
  if (B >= 10 && totalKos > 0) {
    for (const set of userTeam) {
      const id = toId(set.species);
      if ((kos.get(id) ?? 0) === 0) {
        out.push({
          kind: 'ko-drought',
          severity: 'low',
          targetSpeciesId: id,
          sentence: `${set.species} has not scored a single KO in ${B} battles vs ${card.label}: it may be too passive; consider a stronger attacking option or more offensive investment.`,
          evidence: [...kos.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([kid, count]) => `${name(kid)}: ${count} KO${count === 1 ? '' : 's'}`),
        });
      }
    }
  }

  return out;
}

/** Calc-backed suggestions against the card's worst matchup. */
export function calcSuggestions(ctx: PairingContext, worst: MatchupAggregate): Suggestion[] {
  const out: Suggestion[] = [];
  const oppMons = ctx.state.sides[1].mons.filter(m => !m.fainted);
  const myMons = ctx.state.sides[0].mons.filter(m => !m.fainted);
  const oppByWork = worst.mostWork
    .slice(0, 2)
    .map(w => oppMons.find(m => m.speciesId === w.speciesId))
    .filter((m): m is NonNullable<typeof m> => !!m);

  for (const opp of oppByWork) {
    // 3. no-answer: even your best option loses the one-on-one.
    const answer = bestAnswer(ctx, opp);
    if (answer && answer.outgoing - answer.incoming < 0) {
      out.push({
        kind: 'no-answer',
        severity: 'high',
        sentence: `You have no reliable answer to ${name(opp.speciesId)}: your best option (${answer.species}) still loses the one-on-one; add a resist or a dedicated check.`,
        evidence: [
          `${answer.species} deals ~${pct(answer.outgoing)} per turn but takes ~${pct(answer.incoming)} back (best case)`,
        ],
      });
    }

    // 7. unchecked-sweeper: 2HKOs (or better) at least half your team.
    const threatened: string[] = [];
    for (const mine of myMons) {
      const bt = bestThreat(ctx, 1, opp, mine);
      if (bt && bt.koTurns >= 1 && bt.koTurns <= 2) {
        threatened.push(
          `${bt.moveName} vs ${name(mine.speciesId)}: ${bt.koTurns === 1 ? 'OHKO range' : '2HKO'}` +
            (bt.koProb > 0 ? ` (${pct(bt.koProb)} OHKO)` : '')
        );
      }
    }
    if (threatened.length >= 3) {
      out.push({
        kind: 'unchecked-sweeper',
        severity: 'high',
        sentence: `${name(opp.speciesId)} 2HKOs at least half your team (${threatened.length}/${myMons.length}): it needs a dedicated answer (a bulky resist, a Scarf revenge-killer, or priority).`,
        evidence: threatened,
      });
    }
  }

  return out;
}
