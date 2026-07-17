/**
 * Showdown protocol -> typed replay events (cinematic battle view, ui-spec
 * §6a). Parses the SECRET copy of `|split|` pairs (exact HP / maxhp — we
 * own both sides), the inverse of render.ts which keeps the public copy.
 * Unknown-but-meaningful lines become `note` events so nothing is silently
 * dropped; pure noise (timestamps, prelude) is skipped.
 */

export interface Ref {
  side: 0 | 1;
  /** Protocol nickname (equals species display name for our sets, possibly truncated). */
  name: string;
}

export interface MoveTags {
  crit?: boolean;
  supereffective?: boolean;
  resisted?: boolean;
  miss?: boolean;
  immune?: boolean;
}

export type ReplayEvent =
  | {kind: 'turn'; turn: number}
  | {kind: 'switch'; ref: Ref; species: string; hp: number; maxhp: number; drag: boolean; logText: string}
  | {kind: 'move'; ref: Ref; move: string; target?: Ref; tags: MoveTags; logText: string}
  | {kind: 'damage'; ref: Ref; hp: number; maxhp: number; from?: string; sourceMove?: {ref: Ref; move: string}; logText: string}
  | {kind: 'heal'; ref: Ref; hp: number; maxhp: number; from?: string; logText: string}
  | {kind: 'faint'; ref: Ref; logText: string}
  | {kind: 'status'; ref: Ref; status: string; logText: string}
  | {kind: 'curestatus'; ref: Ref; status: string; logText: string}
  | {kind: 'boost'; ref: Ref; stat: string; delta: number; logText: string}
  | {kind: 'weather'; weather: string; logText: string}
  | {kind: 'field'; effect: string; start: boolean; logText: string}
  | {kind: 'side'; side: 0 | 1; effect: string; start: boolean; logText: string}
  | {kind: 'tera'; ref: Ref; teraType: string; logText: string}
  | {kind: 'cant'; ref: Ref; reason: string; logText: string}
  | {kind: 'note'; text: string; logText: string}
  | {kind: 'win'; side: 0 | 1 | null; logText: string};

export function parseRef(ident: string): Ref | undefined {
  const match = /^p([12])[a-c]?: (.*)$/.exec(ident);
  if (!match) return undefined;
  return {side: (Number(match[1]) - 1) as 0 | 1, name: match[2]};
}

function parseHp(condition: string): {hp: number; maxhp: number; fainted: boolean} {
  const [current] = condition.split(' ');
  if (current === '0' || condition.endsWith('fnt')) return {hp: 0, maxhp: 0, fainted: true};
  const [hp, maxhp] = current.split('/').map(Number);
  return {hp: hp || 0, maxhp: maxhp || 100, fainted: false};
}

const SKIP = new Set([
  '', 't:', 'gametype', 'player', 'gen', 'tier', 'rule', 'clearpoke', 'poke', 'teampreview',
  'teamsize', 'start', 'upkeep', 'debug', '-anim', '-hitcount', 'j', 'l', '-fieldactivate',
]);

const NOTE_KINDS = new Set([
  '-ability', '-item', '-enditem', '-activate', '-start', '-end', '-singleturn', '-singlemove',
  '-clearallboost', '-clearboost', '-clearnegativeboost', '-copyboost', '-invertboost',
  '-swapboost', '-setboost', '-restoreboost', '-mustrecharge', '-prepare', '-fail', '-block',
  '-transform', '-formechange', 'detailschange', 'replace', '-swapsideconditions', '-notarget',
  '-zbroken', '-center', '-combine', '-waiting', '-burst', '-primal', '-mega',
]);

/**
 * Human sentence subject for the paced log panel. `names` are possessive-position
 * labels ("Your" / "The opposing"), so `${label} used X` and `${label}'s Ability`
 * both read naturally — no hardcoded `'s` on the label itself.
 */
const label = (ref: Ref, names: [string, string]) => `${names[ref.side]} ${ref.name}`;

/**
 * Clean human text for a "note" protocol line, or null to drop it (never leak
 * the raw protocol string). Covers the common OU cases; `[silent]` lines and
 * anything unmapped are dropped by the caller.
 */
function noteLogText(kind: string, parts: string[], names: [string, string]): string | null {
  const ref = parseRef(parts[2] ?? '');
  if (!ref) return null;
  const who = label(ref, names);
  const effect = (parts[3] ?? '').replace(/^(ability|move|item): /, '');
  switch (kind) {
    case '-ability':
      return effect ? `${who}'s ${effect}!` : null;
    case '-activate':
      return /^ability: /.test(parts[3] ?? '') && effect ? `${who}'s ${effect}!` : null;
    case '-item':
      return effect ? `${who}'s ${effect} was revealed!` : null;
    case '-enditem':
      return effect ? `${who} lost its ${effect}!` : null;
    case '-start':
      return /substitute/i.test(effect) ? `${who} put up a substitute!` : null;
    case '-end':
      return /substitute/i.test(effect) ? `${who}'s substitute faded!` : null;
    case '-singleturn':
      return /protect|detect|endure|guard/i.test(effect) ? `${who} protected itself!` : null;
    default:
      return null;
  }
}

export function parseProtocol(log: string[], names: [string, string] = ['P1', 'P2']): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  let pendingMove: {ref: Ref; move: string; eventIndex: number} | undefined;

  const tagPending = (tag: keyof MoveTags) => {
    if (!pendingMove) return;
    const event = events[pendingMove.eventIndex];
    if (event?.kind === 'move') event.tags[tag] = true;
  };

  for (let i = 0; i < log.length; i++) {
    let line = log[i];
    let parts = line.split('|');
    let kind = parts[1];

    // '|split|pN' precedes a secret/public pair of the SAME event: keep the
    // secret copy (exact HP — we own both sides), skip the public one.
    if (kind === 'split') {
      const secret = log[i + 1];
      if (secret === undefined) continue;
      line = secret;
      parts = line.split('|');
      kind = parts[1];
      i += 2; // consume secret + public copies
    }

    if (SKIP.has(kind)) continue;

    switch (kind) {
      case 'turn':
        pendingMove = undefined;
        events.push({kind: 'turn', turn: Number(parts[2])});
        break;
      case 'switch':
      case 'drag': {
        pendingMove = undefined;
        const ref = parseRef(parts[2]);
        if (!ref) break;
        const species = (parts[3] ?? '').split(',')[0] || ref.name;
        const {hp, maxhp} = parseHp(parts[4] ?? '100/100');
        events.push({
          kind: 'switch', ref, species, hp, maxhp: maxhp || hp, drag: kind === 'drag',
          logText: `${label(ref, names)} ${kind === 'drag' ? 'was dragged in' : 'switched in'}!`,
        });
        break;
      }
      case 'move': {
        const ref = parseRef(parts[2]);
        if (!ref) break;
        const target = parts[4] ? parseRef(parts[4]) : undefined;
        events.push({
          kind: 'move', ref, move: parts[3], target, tags: {},
          logText: `${label(ref, names)} used ${parts[3]}!`,
        });
        pendingMove = {ref, move: parts[3], eventIndex: events.length - 1};
        break;
      }
      case '-damage': {
        const ref = parseRef(parts[2]);
        if (!ref) break;
        const {hp, maxhp} = parseHp(parts[3]);
        const from = parts.find(p => p.startsWith('[from]'))?.replace('[from] ', '');
        const sourceMove =
          !from && pendingMove && pendingMove.ref.side !== ref.side
            ? {ref: pendingMove.ref, move: pendingMove.move}
            : undefined;
        events.push({
          kind: 'damage', ref, hp, maxhp, from, sourceMove,
          logText: from ? `${label(ref, names)} was hurt by ${from.replace(/^(move|item|ability): /, '')}!` : '',
        });
        break;
      }
      case '-heal': {
        const ref = parseRef(parts[2]);
        if (!ref) break;
        const {hp, maxhp} = parseHp(parts[3]);
        const from = parts.find(p => p.startsWith('[from]'))?.replace('[from] ', '');
        events.push({
          kind: 'heal', ref, hp, maxhp, from,
          logText: `${label(ref, names)} restored HP.`,
        });
        break;
      }
      case 'faint': {
        const ref = parseRef(parts[2]);
        if (!ref) break;
        events.push({kind: 'faint', ref, logText: `${label(ref, names)} fainted!`});
        break;
      }
      case '-status': {
        const ref = parseRef(parts[2]);
        if (!ref) break;
        events.push({kind: 'status', ref, status: parts[3], logText: `${label(ref, names)} is now ${parts[3]}!`});
        break;
      }
      case '-curestatus': {
        const ref = parseRef(parts[2]);
        if (!ref) break;
        events.push({kind: 'curestatus', ref, status: parts[3], logText: `${label(ref, names)} was cured of ${parts[3]}.`});
        break;
      }
      case '-boost':
      case '-unboost': {
        const ref = parseRef(parts[2]);
        if (!ref) break;
        const delta = (kind === '-boost' ? 1 : -1) * Number(parts[4]);
        events.push({
          kind: 'boost', ref, stat: parts[3], delta,
          logText: `${label(ref, names)}: ${delta > 0 ? '+' : ''}${delta} ${parts[3]}`,
        });
        break;
      }
      case '-weather': {
        const weather = parts[2] === 'none' ? '' : parts[2];
        // '[upkeep]' continuation lines are noise for the view.
        if (parts.includes('[upkeep]')) break;
        events.push({kind: 'weather', weather, logText: weather ? `The weather became ${weather}!` : 'The weather cleared.'});
        break;
      }
      case '-fieldstart':
      case '-fieldend':
        events.push({
          kind: 'field',
          effect: parts[2].replace(/^move: /, ''),
          start: kind === '-fieldstart',
          logText: `${parts[2].replace(/^move: /, '')} ${kind === '-fieldstart' ? 'started' : 'ended'}.`,
        });
        break;
      case '-sidestart':
      case '-sideend': {
        const sideMatch = /^p([12])/.exec(parts[2]);
        if (!sideMatch) break;
        const side = (Number(sideMatch[1]) - 1) as 0 | 1;
        const effect = parts[3].replace(/^move: /, '');
        events.push({
          kind: 'side', side, effect, start: kind === '-sidestart',
          logText: `${effect} ${kind === '-sidestart' ? `went up on ${names[side]} side` : `faded on ${names[side]} side`}.`,
        });
        break;
      }
      case '-terastallize': {
        const ref = parseRef(parts[2]);
        if (!ref) break;
        events.push({kind: 'tera', ref, teraType: parts[3], logText: `${label(ref, names)} TERASTALLIZED into ${parts[3]}!`});
        break;
      }
      case 'cant': {
        const ref = parseRef(parts[2]);
        if (!ref) break;
        pendingMove = undefined;
        events.push({kind: 'cant', ref, reason: parts[3], logText: `${label(ref, names)} can't move (${parts[3]})!`});
        break;
      }
      case '-crit':
        tagPending('crit');
        events.push({kind: 'note', text: 'crit', logText: 'A critical hit!'});
        break;
      case '-supereffective':
        tagPending('supereffective');
        events.push({kind: 'note', text: 'supereffective', logText: "It's super effective!"});
        break;
      case '-resisted':
        tagPending('resisted');
        events.push({kind: 'note', text: 'resisted', logText: "It's not very effective..."});
        break;
      case '-miss':
        tagPending('miss');
        events.push({kind: 'note', text: 'miss', logText: 'The attack missed!'});
        break;
      case '-immune':
        tagPending('immune');
        events.push({kind: 'note', text: 'immune', logText: "It doesn't affect the target..."});
        break;
      case 'win': {
        const side = parts[2] === names[0] || parts[2] === 'P1' ? 0 : parts[2] === names[1] || parts[2] === 'P2' ? 1 : null;
        events.push({kind: 'win', side, logText: `${parts[2]} wins!`});
        break;
      }
      case 'tie':
        events.push({kind: 'win', side: null, logText: 'The battle ended in a tie.'});
        break;
      default: {
        // Keep every line accounted as an event, but NEVER print the raw
        // protocol string. `[silent]` lines are display-suppressed by Showdown
        // (this also hides the upstream `fallenundefined` Supreme Overlord line);
        // otherwise use a clean translation if we have one, else drop the text.
        const logText = parts.includes('[silent]') ? '' : noteLogText(kind, parts, names) ?? '';
        events.push({kind: 'note', text: NOTE_KINDS.has(kind) ? kind : `unknown:${kind}`, logText});
      }
    }
  }
  return events;
}
