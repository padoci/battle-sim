import {fasterSide} from '../engine/eval';
import type {BattleState} from '../engine/snapshot';

export interface FaintEvent {
  side: 0 | 1;
  speciesId: string;
  turn: number;
  /** Species that got attribution for the KO (see caveat on attribution). */
  causeSpeciesId?: string;
  causeKind: 'move' | 'residual' | 'hazard' | 'other';
}

/** Structured per-battle facts for the aggregate analysis (ui-spec §6c). */
export interface BattleStats {
  faints: FaintEvent[];
  /**
   * damageDealtFrac[side][attackerSpeciesId] = summed fraction of opposing
   * max HP attributed to that attacker across the battle.
   */
  damageDealtFrac: [Record<string, number>, Record<string, number>];
  /** Per-decision speed-race tally between the two actives. */
  speedRace: {fasterCounts: [number, number]; ties: number};
}

export function emptyStats(): BattleStats {
  return {faints: [], damageDealtFrac: [{}, {}], speedRace: {fasterCounts: [0, 0], ties: 0}};
}

const HAZARD_SOURCES = new Set(['stealthrock', 'spikes', 'gmaxsteelsurge']);
const RESIDUAL_SOURCES = new Set([
  'psn', 'tox', 'brn', 'sandstorm', 'hail', 'snow', 'leechseed', 'curse', 'nightmare',
  'saltcure', 'flameburst', 'roughskin', 'ironbarbs', 'aftermath', 'liquidooze',
  'lifeorb', 'blacksludge', 'stickybarb', 'recoil', 'mindblown', 'highjumpkick',
]);

interface Attribution {
  causeSpeciesId?: string;
  causeKind: FaintEvent['causeKind'];
}

const toId = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** 'p1a: Kingambit' -> {side: 0, speciesId-ish nickname id}. */
function parseIdent(ident: string): {side: 0 | 1; nameId: string} | undefined {
  const match = /^p([12])a?: (.*)$/.exec(ident);
  if (!match) return undefined;
  return {side: (Number(match[1]) - 1) as 0 | 1, nameId: toId(match[2])};
}

/**
 * Attribute damage/faints this turn by scanning the turn's protocol lines.
 *
 * First-pass heuristic (documented approximation, like burnMultiplier): a
 * `-damage` line with a `[from]` annotation is classified hazard/residual by
 * source id; a bare `-damage` line is credited to the actor of the most
 * recent `move` line. Same-turn multi-source edge cases may misattribute.
 */
function buildAttribution(turnLines: string[]): Map<string, Attribution> {
  const attribution = new Map<string, Attribution>();
  let lastMoveActor: {side: 0 | 1; nameId: string} | undefined;

  for (const line of turnLines) {
    const parts = line.split('|');
    const kind = parts[1];
    if (kind === 'move') {
      lastMoveActor = parseIdent(parts[2]);
      continue;
    }
    if (kind !== '-damage') continue;
    const target = parseIdent(parts[2]);
    if (!target) continue;
    const from = parts.find(p => p.startsWith('[from]'));
    const key = `${target.side}:${target.nameId}`;

    if (from) {
      const source = toId(from.replace('[from]', '').replace(/^(item|ability|move):/, ''));
      if (HAZARD_SOURCES.has(source)) {
        attribution.set(key, {causeKind: 'hazard'});
      } else if (RESIDUAL_SOURCES.has(source)) {
        attribution.set(key, {causeKind: 'residual'});
      } else {
        attribution.set(key, {causeKind: 'other'});
      }
    } else if (lastMoveActor && lastMoveActor.side !== target.side) {
      attribution.set(key, {
        causeSpeciesId: lastMoveActor.nameId,
        causeKind: 'move',
      });
    }
  }
  return attribution;
}

/**
 * Fold one decision's state transition into the running stats.
 * Damage magnitudes come from the exact state diff; attribution comes from
 * the turn's protocol lines.
 */
export function recordTurn(
  stats: BattleStats,
  prev: BattleState,
  next: BattleState,
  turnLines: string[],
  turn: number
): void {
  const attribution = buildAttribution(turnLines);

  for (const side of [0, 1] as const) {
    for (const [slot, prevMon] of prev.sides[side].mons.entries()) {
      const nextMon = next.sides[side].mons.find(m => m.speciesId === prevMon.speciesId) ??
        next.sides[side].mons[slot];
      if (!nextMon) continue;
      const lost = prevMon.hp - nextMon.hp;
      if (lost <= 0 && !(nextMon.fainted && !prevMon.fainted)) continue;

      // Attribution key uses the mon's nickname id; nicknames equal species
      // for all sets we build (name = species in our resolvers). No exact
      // match -> leave unattributed rather than guess.
      const attributionEntry = attribution.get(`${side}:${prevMon.speciesId}`);

      if (lost > 0 && attributionEntry?.causeKind === 'move' && attributionEntry.causeSpeciesId) {
        const dealt = stats.damageDealtFrac[1 - side] as Record<string, number>;
        const frac = lost / prevMon.maxhp;
        dealt[attributionEntry.causeSpeciesId] = (dealt[attributionEntry.causeSpeciesId] ?? 0) + frac;
      }

      if (nextMon.fainted && !prevMon.fainted) {
        stats.faints.push({
          side,
          speciesId: prevMon.speciesId,
          turn,
          causeSpeciesId: attributionEntry?.causeSpeciesId,
          causeKind: attributionEntry?.causeKind ?? 'other',
        });
      }
    }
  }

  // Speed race between the two actives at the START of the decision.
  const [a, b] = prev.sides;
  const monA = a.mons[a.activeIndex];
  const monB = b.mons[b.activeIndex];
  if (monA && monB && !monA.fainted && !monB.fainted) {
    const faster = fasterSide(prev, 0);
    if (faster === 'tie') stats.speedRace.ties++;
    else stats.speedRace.fasterCounts[faster]++;
  }
}
