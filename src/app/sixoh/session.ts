import type {Dispatch} from 'react';
import {seedFromInts} from '../../engine/rng';
import {FAST} from '../../search/config';
import type {BattleJob, Policy} from '../../search/runner';
import {createSimClient, type SimClient} from '../../worker/client';
import type {DraftMode} from '../../draft/draft';
import type {DevParams} from './devParams';
import type {SixOhAction, SixOhState} from './state';

/**
 * Gauntlet sim session: its own worker (independent of test-your-team's),
 * held at module level so route changes never kill a run. `ensureComputed`
 * is idempotent — StrictMode double-effects and re-renders can call it
 * freely; each battle index is submitted at most once per run.
 */
let client: SimClient | undefined;
let submitted = new Set<number>();
let sessionRunSeed: number | undefined;

function getClient(): SimClient {
  if (!client) client = createSimClient();
  return client;
}

/** Terminate the worker and forget submissions (Draft again / new run). */
export function resetSixOhSession(): void {
  client?.cancel();
  client?.terminate();
  client = undefined;
  submitted = new Set();
  sessionRunSeed = undefined;
}

/**
 * The opponent's policy for a given gauntlet rung. Normal/hard field the
 * player's own config (a full-strength mirror) every battle. Easy ramps:
 * the first two rungs move randomly, the middle two search shallowly (FAST),
 * and only the last two match the player — so a run starts gentle and builds
 * to a fair fight. The player is always `dev.config` (STRONG by default).
 */
export function opponentPolicy(mode: DraftMode, index: number, dev: DevParams): Policy {
  if (mode !== 'easy') return {kind: 'search', config: dev.config};
  if (index <= 1) return {kind: 'random'};
  if (index <= 3) return {kind: 'search', config: FAST};
  return {kind: 'search', config: dev.config};
}

function jobFor(state: SixOhState, index: number, dev: DevParams): BattleJob {
  const seed = state.runSeed + index;
  return {
    teams: [state.team!, state.opponents[index].sets],
    battleSeed: seedFromInts(seed & 0xffff, (seed >> 4) & 0xffff, index + 1, 7),
    searchSeed: state.runSeed + index * 7919,
    policies: [
      {kind: 'search', config: dev.config},
      opponentPolicy(state.mode, index, dev),
    ],
    maxTurns: 300,
    collectLog: true,
    collectStats: true,
    ...(dev.tera !== undefined ? {evalOverrides: {teraAvailable: dev.tera}} : {}),
  };
}

/**
 * Submit whatever the run needs next:
 * - the current rung when pending;
 * - prefetch rung N+1 once rung N computed as a WIN (a loss ends the run,
 *   so prefetching after one can never be watched).
 */
export function ensureComputed(
  state: SixOhState,
  dispatch: Dispatch<SixOhAction>,
  dev: DevParams
): void {
  if (state.phase !== 'gauntlet' || !state.team) return;
  if (sessionRunSeed !== state.runSeed) {
    // New run through the same module: forget old submissions.
    submitted = new Set();
    sessionRunSeed = state.runSeed;
  }

  const submit = (index: number) => {
    if (submitted.has(index)) return;
    submitted.add(index);
    dispatch({type: 'BATTLE_COMPUTING', index});
    getClient()
      .run([jobFor(state, index, dev)])
      .then(({results}) => {
        if (results[0]) dispatch({type: 'BATTLE_COMPUTED', index, result: results[0]});
      })
      .catch(error => dispatch({type: 'RUN_ERROR', error: String(error)}));
  };

  const current = state.battles[state.battleIndex];
  if (current && (current.phase === 'pending' || (current.phase === 'computing' && !submitted.has(state.battleIndex)))) {
    submit(state.battleIndex);
  }

  // Prefetch the next rung while this one replays, if this one was a win.
  const next = state.battleIndex + 1;
  if (
    current?.result?.winner === 0 &&
    next < state.battles.length &&
    state.battles[next].phase === 'pending'
  ) {
    submit(next);
  }
}
