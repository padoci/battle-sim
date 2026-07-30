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
  | {
      kind: 'switch';
      ref: Ref;
      species: string;
      hp: number;
      maxhp: number;
      drag: boolean;
      logText: string;
      /** Battle-dialogue only: the "X, come back!" page shown before the
       *  send-out line. Absent when nothing was on the field, when the mon
       *  leaving fainted, or in the neutral analysis voice. */
      recallText?: string;
    }
  | {kind: 'move'; ref: Ref; move: string; target?: Ref; tags: MoveTags; logText: string}
  | {kind: 'damage'; ref: Ref; hp: number; maxhp: number; from?: string; sourceMove?: {ref: Ref; move: string}; logText: string}
  | {kind: 'heal'; ref: Ref; hp: number; maxhp: number; from?: string; logText: string}
  /** An absolute HP assignment that is neither damage nor healing until you
   *  compare it against the bar's current value — Pain Split is the only gen9
   *  move that reports this way. The direction is left to the consumer, which
   *  is the side that knows what the bar was showing. */
  | {kind: 'sethp'; ref: Ref; hp: number; maxhp: number; from?: string; logText: string}
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

/**
 * Undefined for a missing or unparseable condition. Callers DROP the event
 * rather than fabricate an HP number: a truncated `|-damage|p1a: X` used to
 * become "0 HP", i.e. a phantom faint in the replay view.
 */
function parseHp(condition: string | undefined): {hp: number; maxhp: number; fainted: boolean} | undefined {
  if (!condition) return undefined;
  const [current] = condition.split(' ');
  if (current === '0' || condition.endsWith('fnt')) return {hp: 0, maxhp: 0, fainted: true};
  const [hp, maxhp] = current.split('/').map(Number);
  if (!Number.isFinite(hp)) return undefined;
  return {hp: hp || 0, maxhp: Number.isFinite(maxhp) && maxhp ? maxhp : 100, fainted: false};
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
 * How the parsed lines should read.
 *
 * The analysis path (highlights, post-mortems) wants neutral prose about a
 * game that already happened. The battle stage wants what the handheld games
 * put in the textbox while it is happening — "Go! Dragapult!", not "Your
 * Dragapult switched in!". Same events either way; only the sentences differ.
 */
export interface Voice {
  dialogue?: boolean;
  /** The opposing trainer's display name, for send-out and recall lines. */
  trainer?: string;
}

/** The mon's own name, unprefixed for the player's side and "The opposing X"
 * for the foe's — the battle-textbox subject, as against `label`'s
 * possessive-position "Your X" which only reads correctly in prose. */
const actor = (ref: Ref, names: [string, string], voice: Voice) =>
  voice.dialogue ? (ref.side === 0 ? ref.name : `The opposing ${ref.name}`) : label(ref, names);

/** Full stat names: the protocol's three-letter keys are fine for the HP-box
 * chip but read as debug output in a sentence. */
const STAT_NAMES: Record<string, string> = {
  atk: 'Attack',
  def: 'Defense',
  spa: 'Sp. Atk',
  spd: 'Sp. Def',
  spe: 'Speed',
  accuracy: 'accuracy',
  evasion: 'evasiveness',
};

/** The games grade stat changes by size rather than printing the number. */
function boostPhrase(stat: string, delta: number): string {
  const name = STAT_NAMES[stat] ?? stat;
  const size = Math.abs(delta);
  const rose = size >= 3 ? 'rose drastically' : size === 2 ? 'sharply rose' : 'rose';
  const fell = size >= 3 ? 'severely fell' : size === 2 ? 'harshly fell' : 'fell';
  return `${name} ${delta > 0 ? rose : fell}!`;
}

/**
 * Clean human text for a "note" protocol line, or null to drop it (never leak
 * the raw protocol string). Covers the common OU cases; `[silent]` lines and
 * anything unmapped are dropped by the caller.
 */
function noteLogText(
  kind: string,
  parts: string[],
  names: [string, string],
  voice: Voice
): string | null {
  const ref = parseRef(parts[2] ?? '');
  if (!ref) return null;
  const who = actor(ref, names, voice);
  const effect = (parts[3] ?? '').replace(/^(ability|move|item): /, '');
  switch (kind) {
    case '-ability':
      return effect ? (voice.dialogue ? `${who}'s ${effect} activated!` : `${who}'s ${effect}!`) : null;
    case '-activate':
      return /^ability: /.test(parts[3] ?? '') && effect
        ? voice.dialogue ? `${who}'s ${effect} activated!` : `${who}'s ${effect}!`
        : null;
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

/**
 * What to say for a `-sethp` line, by the effect that caused it. Showdown's own
 * wording, minus its leading indent. A miss here logs nothing rather than
 * leaking the raw protocol, same discipline as the default branch below.
 */
const SETHP_TEXT: Record<string, string> = {
  'move: Pain Split': 'The battlers shared their pain!',
};

export function parseProtocol(
  log: string[],
  names: [string, string] = ['P1', 'P2'],
  voice: Voice = {}
): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  let pendingMove: {ref: Ref; move: string; eventIndex: number} | undefined;
  // Who is on the field per side, so a switch can say goodbye to the mon it
  // replaces. Cleared on a faint: a knocked-out Pokemon is not recalled, and
  // the games say nothing before sending out the next one.
  const active: [string | undefined, string | undefined] = [undefined, undefined];

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
      case 'turn': {
        pendingMove = undefined;
        const turn = Number(parts[2]);
        if (!Number.isFinite(turn)) break;
        events.push({kind: 'turn', turn});
        break;
      }
      case 'switch':
      case 'drag': {
        pendingMove = undefined;
        const ref = parseRef(parts[2]);
        if (!ref) break;
        const species = (parts[3] ?? '').split(',')[0] || ref.name;
        const {hp, maxhp} = parseHp(parts[4]) ?? {hp: 100, maxhp: 100};
        const leaving = active[ref.side];
        active[ref.side] = ref.name;
        const foe = voice.trainer ?? 'The opponent';
        const logText = voice.dialogue
          ? kind === 'drag'
            ? `${actor(ref, names, voice)} was dragged out!`
            : ref.side === 0
              ? `Go! ${ref.name}!`
              : `${foe} sent out ${ref.name}!`
          : `${label(ref, names)} ${kind === 'drag' ? 'was dragged in' : 'switched in'}!`;
        // Spoken before the send-out line, as its own textbox page.
        const recallText =
          voice.dialogue && kind === 'switch' && leaving
            ? ref.side === 0
              ? `${leaving}, come back!`
              : `${foe} withdrew ${leaving}!`
            : undefined;
        events.push({
          kind: 'switch', ref, species, hp, maxhp: maxhp || hp, drag: kind === 'drag',
          logText, recallText,
        });
        break;
      }
      case 'move': {
        const ref = parseRef(parts[2]);
        const move = parts[3];
        if (!ref || !move) break;
        const target = parts[4] ? parseRef(parts[4]) : undefined;
        events.push({
          kind: 'move', ref, move, target, tags: {},
          logText: `${actor(ref, names, voice)} used ${move}!`,
        });
        pendingMove = {ref, move, eventIndex: events.length - 1};
        break;
      }
      case '-damage': {
        const ref = parseRef(parts[2]);
        const condition = parseHp(parts[3]);
        if (!ref || !condition) break;
        const {hp, maxhp} = condition;
        const from = parts.find(p => p.startsWith('[from]'))?.replace('[from] ', '');
        const sourceMove =
          !from && pendingMove && pendingMove.ref.side !== ref.side
            ? {ref: pendingMove.ref, move: pendingMove.move}
            : undefined;
        events.push({
          kind: 'damage', ref, hp, maxhp, from, sourceMove,
          logText: from ? `${actor(ref, names, voice)} was hurt by ${from.replace(/^(move|item|ability): /, '')}!` : '',
        });
        break;
      }
      case '-heal': {
        const ref = parseRef(parts[2]);
        const condition = parseHp(parts[3]);
        if (!ref || !condition) break;
        const {hp, maxhp} = condition;
        const from = parts.find(p => p.startsWith('[from]'))?.replace('[from] ', '');
        events.push({
          kind: 'heal', ref, hp, maxhp, from,
          logText: voice.dialogue
            ? `${actor(ref, names, voice)} had its HP restored!`
            : `${label(ref, names)} restored HP.`,
        });
        break;
      }
      case '-sethp': {
        const ref = parseRef(parts[2]);
        const condition = parseHp(parts[3]);
        if (!ref || !condition) break;
        const {hp, maxhp} = condition;
        const from = parts.find(p => p.startsWith('[from]'))?.replace('[from] ', '');
        // Pain Split sends two of these, and marks the TARGET's copy
        // `[silent]` so only one of the pair speaks. Both still move a bar.
        const logText = parts.includes('[silent]') ? '' : (from && SETHP_TEXT[from]) || '';
        events.push({kind: 'sethp', ref, hp, maxhp, from, logText});
        break;
      }
      case 'faint': {
        const ref = parseRef(parts[2]);
        if (!ref) break;
        active[ref.side] = undefined;
        events.push({kind: 'faint', ref, logText: `${actor(ref, names, voice)} fainted!`});
        break;
      }
      case '-status': {
        const ref = parseRef(parts[2]);
        const status = parts[3];
        if (!ref || !status) break;
        events.push({
          kind: 'status', ref, status,
          logText: `${actor(ref, names, voice)} is now ${status}!`,
        });
        break;
      }
      case '-curestatus': {
        const ref = parseRef(parts[2]);
        const status = parts[3];
        if (!ref || !status) break;
        events.push({
          kind: 'curestatus', ref, status,
          logText: `${actor(ref, names, voice)} was cured of ${status}.`,
        });
        break;
      }
      case '-boost':
      case '-unboost': {
        const ref = parseRef(parts[2]);
        const stat = parts[3];
        const amount = Number(parts[4]);
        if (!ref || !stat || !Number.isFinite(amount)) break;
        const delta = (kind === '-boost' ? 1 : -1) * amount;
        events.push({
          kind: 'boost', ref, stat, delta,
          logText: voice.dialogue
            ? `${actor(ref, names, voice)}'s ${boostPhrase(stat, delta)}`
            : `${label(ref, names)}: ${delta > 0 ? '+' : ''}${delta} ${stat}`,
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
      case '-fieldend': {
        const effect = (parts[2] ?? '').replace(/^move: /, '');
        if (!effect) break;
        events.push({
          kind: 'field',
          effect,
          start: kind === '-fieldstart',
          logText: `${effect} ${kind === '-fieldstart' ? 'started' : 'ended'}.`,
        });
        break;
      }
      case '-sidestart':
      case '-sideend': {
        const sideMatch = /^p([12])/.exec(parts[2] ?? '');
        if (!sideMatch) break;
        const side = (Number(sideMatch[1]) - 1) as 0 | 1;
        const effect = (parts[3] ?? '').replace(/^move: /, '');
        if (!effect) break;
        events.push({
          kind: 'side', side, effect, start: kind === '-sidestart',
          // "Your side" only parses as prose; the games name the team.
          logText: voice.dialogue
            ? `${effect} ${kind === '-sidestart' ? 'was scattered around' : 'disappeared from around'} ${
                side === 0 ? 'your team' : 'the opposing team'
              }!`
            : `${effect} ${kind === '-sidestart' ? `went up on ${names[side]} side` : `faded on ${names[side]} side`}.`,
        });
        break;
      }
      case '-terastallize': {
        const ref = parseRef(parts[2]);
        const teraType = parts[3];
        if (!ref || !teraType) break;
        events.push({
          kind: 'tera', ref, teraType,
          logText: `${actor(ref, names, voice)} TERASTALLIZED into ${teraType}!`,
        });
        break;
      }
      case 'cant': {
        const ref = parseRef(parts[2]);
        if (!ref) break;
        pendingMove = undefined;
        const reason = parts[3] ?? '';
        events.push({
          kind: 'cant', ref, reason,
          logText: reason
            ? `${actor(ref, names, voice)} can't move (${reason})!`
            : `${actor(ref, names, voice)} can't move!`,
        });
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
        const who = parts[2];
        if (!who) break;
        const side = who === names[0] || who === 'P1' ? 0 : who === names[1] || who === 'P2' ? 1 : null;
        events.push({kind: 'win', side, logText: `${who} wins!`});
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
        const logText = parts.includes('[silent]') ? '' : noteLogText(kind, parts, names, voice) ?? '';
        events.push({kind: 'note', text: NOTE_KINDS.has(kind) ? kind : `unknown:${kind}`, logText});
      }
    }
  }
  return events;
}
