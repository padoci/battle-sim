import {parseProtocol, type Ref} from '../replay/parse';

/**
 * The single biggest hit found in a battle's protocol log — real, mined
 * fact for the "Can you 6-0?" run recap (postmortem.ts), never fabricated
 * prose. Deliberately narrow: one number, one move, one verdict, so the
 * recap can build a punchy sentence directly from it.
 */
export interface BattleHighlight {
  attackerSpecies: string;
  defenderSpecies: string;
  move: string;
  /** Percent of the defender's max HP removed by this hit, 0-100. */
  pct: number;
  crit: boolean;
  superEffective: boolean;
  /** This hit was the one that knocked its target out. */
  ohko: boolean;
}

const refKey = (ref: Ref) => `${ref.side}:${ref.name}`;

/**
 * Scans a battle's protocol log for the single largest hit directly
 * attributed to a move (`parseProtocol` already resolves move->damage
 * attribution and crit/super-effective tags — see its `sourceMove` field
 * and `MoveTags`, both fully resolved by the time it returns). Hazard,
 * residual, item-chip, and self-inflicted damage never qualify: those
 * damage events carry no `sourceMove` (parseProtocol only sets it for a
 * `from`-less hit landed by the OTHER side's most recent move), so a
 * Stealth Rock tick can never crowd out an actual attack as "the biggest
 * hit". Returns undefined if the log has no qualifying hit at all.
 */
export function findBiggestHit(protocolLog: string[]): BattleHighlight | undefined {
  const events = parseProtocol(protocolLog, ['You', 'The opponent']);
  const species = new Map<string, string>();
  const hp = new Map<string, {hp: number; maxhp: number}>();
  let lastMove: Extract<(typeof events)[number], {kind: 'move'}> | undefined;
  let best: BattleHighlight | undefined;

  for (const event of events) {
    if (event.kind === 'switch') {
      species.set(refKey(event.ref), event.species);
      hp.set(refKey(event.ref), {hp: event.hp, maxhp: event.maxhp});
    } else if (event.kind === 'move') {
      lastMove = event;
    } else if (event.kind === 'damage') {
      const key = refKey(event.ref);
      const prev = hp.get(key);
      const beforeFrac = prev && prev.maxhp > 0 ? prev.hp / prev.maxhp : 1;
      const afterFrac = event.maxhp > 0 ? event.hp / event.maxhp : 0;
      const pct = Math.round(Math.max(0, beforeFrac - afterFrac) * 100);
      hp.set(key, {hp: event.hp, maxhp: event.maxhp});

      if (event.sourceMove && lastMove && pct > 0 && (!best || pct > best.pct)) {
        best = {
          attackerSpecies: species.get(refKey(event.sourceMove.ref)) ?? event.sourceMove.ref.name,
          defenderSpecies: species.get(key) ?? event.ref.name,
          move: event.sourceMove.move,
          pct,
          crit: !!lastMove.tags.crit,
          superEffective: !!lastMove.tags.supereffective,
          ohko: event.hp === 0,
        };
      }
    }
  }
  return best;
}
