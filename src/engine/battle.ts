import {Battle, PRNG, State} from '@pkmn/sim';
import type {PokemonSet} from '../data/types';
import {randomSeed, type Seed} from './rng';

export interface CreateBattleOptions {
  p1: {name?: string; team: PokemonSet[]};
  p2: {name?: string; team: PokemonSet[]};
  /** Battle-internal PRNG seed; omit for a random one. */
  seed?: Seed;
}

const FORMAT = 'gen9ou';

/**
 * Create a gen9ou battle from two concrete teams and play through team
 * preview so callers start at a real turn-1 move request.
 *
 * We drive `Battle` directly (not BattleStreams) — the search loop needs
 * synchronous transitions. `strictChoices` makes bad choice strings throw
 * instead of silently auto-choosing.
 *
 * v1 always leads slot 1 (`team 123456`); lead selection is a search
 * decision deferred to Stage 2+.
 */
export function createBattle(options: CreateBattleOptions): Battle {
  const battle = new Battle({
    formatid: FORMAT as never,
    seed: options.seed ?? randomSeed(),
    p1: {name: options.p1.name ?? 'P1', team: options.p1.team as never},
    p2: {name: options.p2.name ?? 'P2', team: options.p2.team as never},
    strictChoices: true,
  });
  if (battle.requestState === 'teampreview') {
    battle.makeChoices('team 123456', 'team 123456');
  }
  return battle;
}

/**
 * A frozen, JSON-able copy of a battle. Restore as many independent
 * branches from one snapshot as you like.
 */
export type BattleSnapshot = {readonly __brand: 'BattleSnapshot'};

/**
 * Snapshot a battle for later restore.
 *
 * `State.serializeBattle` sets `state.log` to the live battle's log array
 * *by reference* (and `deserializeBattle` hands it back the same way), so
 * without intervention every restored branch appends to the shared snapshot
 * array — unbounded growth and cross-branch pollution. We strip the log on
 * both sides; nothing in search consumes it.
 *
 * (Fallback mechanism if serialize ever breaks: fresh battle + replay of
 * `battle.inputLog` — correct but costs ~2.3 ms x turns-so-far per restore,
 * losing to serialize/restore after roughly turn 2.)
 */
export function snapshot(battle: Battle): BattleSnapshot {
  const state = State.serializeBattle(battle) as {log: string[]};
  state.log = [];
  return state as unknown as BattleSnapshot;
}

/** Restore an independent battle from a snapshot (snapshot stays reusable). */
export function restore(snap: BattleSnapshot): Battle {
  return State.deserializeBattle({...(snap as object), log: []} as never);
}

/**
 * Replace a battle's internal PRNG.
 *
 * CRITICAL for search: `restore` preserves the serialized PRNG seed, so an
 * un-reseeded search branch replays the live battle's exact future RNG
 * stream — the bot would know this turn's crit/miss/roll before choosing.
 * Every search branch must be re-seeded with a deterministic fork seed.
 */
export function reseed(battle: Battle, seed: Seed): void {
  battle.prng = new PRNG(seed);
}

/** Apply a joint action synchronously. Empty string = auto-choose (wait). */
export function makeJointChoice(battle: Battle, c1: string, c2: string): void {
  battle.makeChoices(c1, c2);
}

export function isOver(battle: Battle): boolean {
  return battle.ended;
}

/** Winning side index, or null while running / on a tie. */
export function winner(battle: Battle): 0 | 1 | null {
  if (!battle.ended || !battle.winner) return null;
  if (battle.winner === battle.sides[0].name) return 0;
  if (battle.winner === battle.sides[1].name) return 1;
  return null;
}
