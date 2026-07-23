import {gen9} from '../data/gen';
import type {PokemonSet} from '../data/types';
import type {Beat} from './pace';

/** What the battle stage renders at one instant. */
export interface MonView {
  /** Protocol nickname key (equals the set's name/species for our teams). */
  name: string;
  species: string;
  hp: number;
  maxhp: number;
  fainted: boolean;
  status?: string;
  boosts: Record<string, number>;
  teraType?: string;
}

export interface SideView {
  mons: MonView[];
  /** Index into mons of the active mon; undefined before first switch-in. */
  activeIndex?: number;
  /** effect name -> layer count (1 for binary conditions). */
  hazards: Record<string, number>;
  screens: string[];
}

export interface ViewState {
  sides: [SideView, SideView];
  weather: string;
  fields: string[];
  turn: number;
  winner?: 0 | 1 | null;
  /** Rolling log lines already "spoken". */
  logLines: string[];
}

/** One visual effect triggered by a beat. */
export interface FxItem {
  type: 'lunge' | 'impact' | 'float' | 'faint' | 'tera' | 'switch';
  side: 0 | 1;
  text?: string;
  /** The move's type ("Fire") — drives the FX accent color. */
  moveType?: string;
  /** Physical → contact spark, Special → beam, Status → self glow. */
  category?: 'Physical' | 'Special' | 'Status';
  /** The move's exact name ("Knock Off") — drives the small curated set of
   *  signature per-move overrides (SIGNATURE_MOVES in SixOhGauntlet.tsx). */
  move?: string;
  /** `impact` only: a critical hit — drives the extra screen-flash treatment. */
  crit?: boolean;
  /** `switch` only: the species leaving the field this beat, if any (undefined
   *  at the turn-0 lead placement, or when the outgoing mon already fainted
   *  and played its own exit) — lets the stage render a switch-out alongside
   *  the switch-in pop instead of a bare cut. */
  outgoingSpecies?: string;
}

const HAZARDS = new Set(['Stealth Rock', 'Spikes', 'Toxic Spikes', 'Sticky Web', 'G-Max Steelsurge']);

/** Status-category moves that still visibly land on the opponent — see the
 * 'move' case below. Deliberately small: every other status move keeps the
 * default self-glow-only treatment. */
const STATUS_SIGNATURE_TARGETS = new Set([
  'Toxic',
  'Will-O-Wisp',
  'Thunder Wave',
  'Taunt',
  'Trick',
  'Roar',
  'Encore',
  'Stun Spore',
  'Leech Seed',
  'Whirlwind',
  'Skill Swap',
  'Parting Shot',
  'Strength Sap',
]);

export function initView(teams: [PokemonSet[], PokemonSet[]]): ViewState {
  const side = (sets: PokemonSet[]): SideView => ({
    mons: sets.map(set => ({
      name: set.name || set.species,
      species: set.species,
      hp: 1,
      maxhp: 1, // exact values arrive with the first (secret) switch line
      fainted: false,
      boosts: {},
    })),
    activeIndex: undefined,
    hazards: {},
    screens: [],
  });
  return {sides: [side(teams[0]), side(teams[1])], weather: '', fields: [], turn: 0, logLines: []};
}

function findMon(side: SideView, name: string, species?: string): MonView | undefined {
  // Nickname match first; species fallback (protocol may shorten nicknames,
  // e.g. 'Slowking-Galar' set name -> 'Slowking' ident).
  return (
    side.mons.find(m => m.name === name) ??
    side.mons.find(m => m.species === species) ??
    side.mons.find(m => m.species.startsWith(name) || name.startsWith(m.species.split('-')[0]))
  );
}

/** Apply one beat, returning the next state plus the FX it triggers. */
export function applyBeat(state: ViewState, beat: Beat): {state: ViewState; fx: FxItem[]} {
  // Deep-enough clone of the mutable parts.
  const next: ViewState = {
    ...state,
    sides: state.sides.map(side => ({
      ...side,
      mons: side.mons.map(m => ({...m, boosts: {...m.boosts}})),
      hazards: {...side.hazards},
      screens: [...side.screens],
    })) as [SideView, SideView],
    fields: [...state.fields],
    logLines: [...state.logLines],
  };
  const fx: FxItem[] = [];

  for (const event of beat.events) {
    if ('logText' in event && event.logText) next.logLines.push(event.logText);
    switch (event.kind) {
      case 'turn':
        next.turn = event.turn;
        next.logLines.push(`Turn ${event.turn}`);
        break;
      case 'switch': {
        const side = next.sides[event.ref.side];
        // Captured before activeIndex moves on — the mon leaving the field,
        // if any (undefined at turn-0 lead placement, or a fainted mon that
        // already dropped off-stage with its own faint animation).
        const outgoing = side.activeIndex !== undefined ? side.mons[side.activeIndex] : undefined;
        let mon = findMon(side, event.ref.name, event.species);
        if (!mon) {
          mon = {name: event.ref.name, species: event.species, hp: event.hp, maxhp: event.maxhp, fainted: false, boosts: {}};
          side.mons.push(mon);
        }
        mon.name = event.ref.name;
        mon.hp = event.hp;
        mon.maxhp = event.maxhp;
        mon.boosts = {}; // switching resets boosts
        side.activeIndex = side.mons.indexOf(mon);
        // Switch-in pop — but not for the initial lead placement (turn 0):
        // the lead-in frame must stay at rest for the visual baseline.
        if (state.turn >= 1) {
          fx.push({
            type: 'switch',
            side: event.ref.side,
            outgoingSpecies: outgoing && !outgoing.fainted ? outgoing.species : undefined,
          });
        }
        break;
      }
      case 'move': {
        // Type/category flavor the FX (color + animation style). Unknown moves
        // (or a lookup miss) degrade to the untyped default — never throw.
        const meta = gen9().moves.get(event.move);
        const moveType = meta?.type;
        const category = (meta?.category ?? undefined) as FxItem['category'];
        fx.push({type: 'lunge', side: event.ref.side, moveType, category, move: event.move});
        // Status moves act on the user (glow) — no defender impact, EXCEPT a
        // small curated set of status moves that visibly debilitate the
        // opponent (Toxic, Will-O-Wisp, Thunder Wave, Taunt): those get their
        // signature landing FX too (see STATUS_SIGNATURE_TARGETS + the
        // fx-signature-<slug> overrides in app.css), so a status effect
        // actually lands on the target instead of vanishing into the user's
        // own glow.
        const targetsOpponent = category !== 'Status' || STATUS_SIGNATURE_TARGETS.has(event.move);
        if (targetsOpponent && !event.tags.miss && !event.tags.immune) {
          fx.push({
            type: 'impact',
            side: (1 - event.ref.side) as 0 | 1,
            moveType,
            category,
            move: event.move,
            crit: event.tags.crit,
          });
        }
        break;
      }
      case 'damage': {
        const mon = findMon(next.sides[event.ref.side], event.ref.name);
        if (!mon) break;
        const before = mon.maxhp > 1 ? mon.hp / mon.maxhp : 1;
        mon.hp = event.hp;
        if (event.maxhp > 0) mon.maxhp = Math.max(mon.maxhp, event.maxhp);
        const after = mon.maxhp > 1 ? mon.hp / mon.maxhp : 0;
        const delta = Math.round((before - after) * 100);
        if (delta > 0) fx.push({type: 'float', side: event.ref.side, text: `−${delta}%`});
        break;
      }
      case 'heal': {
        const mon = findMon(next.sides[event.ref.side], event.ref.name);
        if (!mon) break;
        const before = mon.hp / mon.maxhp;
        mon.hp = event.hp;
        const delta = Math.round((event.hp / mon.maxhp - before) * 100);
        if (delta > 0) fx.push({type: 'float', side: event.ref.side, text: `+${delta}%`});
        break;
      }
      case 'faint': {
        const mon = findMon(next.sides[event.ref.side], event.ref.name);
        if (mon) {
          mon.fainted = true;
          mon.hp = 0;
        }
        fx.push({type: 'faint', side: event.ref.side});
        break;
      }
      case 'status': {
        const mon = findMon(next.sides[event.ref.side], event.ref.name);
        if (mon) mon.status = event.status;
        break;
      }
      case 'curestatus': {
        const mon = findMon(next.sides[event.ref.side], event.ref.name);
        if (mon) mon.status = undefined;
        break;
      }
      case 'boost': {
        const mon = findMon(next.sides[event.ref.side], event.ref.name);
        if (mon) mon.boosts[event.stat] = (mon.boosts[event.stat] ?? 0) + event.delta;
        break;
      }
      case 'weather':
        next.weather = event.weather;
        break;
      case 'field':
        next.fields = event.start
          ? [...new Set([...next.fields, event.effect])]
          : next.fields.filter(f => f !== event.effect);
        break;
      case 'side': {
        const side = next.sides[event.side];
        if (HAZARDS.has(event.effect)) {
          if (event.start) side.hazards[event.effect] = (side.hazards[event.effect] ?? 0) + 1;
          else delete side.hazards[event.effect];
        } else {
          side.screens = event.start
            ? [...new Set([...side.screens, event.effect])]
            : side.screens.filter(s => s !== event.effect);
        }
        break;
      }
      case 'tera': {
        const mon = findMon(next.sides[event.ref.side], event.ref.name);
        if (mon) mon.teraType = event.teraType;
        fx.push({type: 'tera', side: event.ref.side});
        break;
      }
      case 'win':
        next.winner = event.side;
        break;
      case 'cant':
      case 'note':
        break;
    }
  }
  return {state: next, fx};
}

/** Fold every remaining beat with no waits (instant / skip-to-result). */
export function foldBeats(state: ViewState, beats: Beat[], fromIndex: number): ViewState {
  let current = state;
  for (let i = fromIndex; i < beats.length; i++) {
    current = applyBeat(current, beats[i]).state;
  }
  return current;
}
