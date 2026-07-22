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
 * Allow a failed rung to be recomputed: forget its submission so the next
 * `ensureComputed` resubmits it (paired with the reducer's CLEAR_ERROR, which
 * resets the rung to `pending`).
 */
export function retryBattle(index: number): void {
  submitted.delete(index);
}

/**
 * Per-rung blunder rate for Easy: a competent opponent that misplays into a
 * random move this fraction of the time, decaying to 0 by the last rung.
 * Tuned from headless gauntlet sims (scripts/sim-gauntlet.ts) — this smooth
 * decay gives a gentle-to-fair difficulty slope with no cliff, unlike the
 * old random→FAST→full jump which was two free wins then a wall at rung 3.
 */
const EASY_BLUNDER = [0.75, 0.55, 0.4, 0.25, 0.1, 0];

/**
 * Per-rung blunder rate for Gym Leader. Counterintuitively LOWER than Easy's
 * at every rung: the gym leader rosters (real trainers' teams, picked for
 * flavor/authenticity over competitive optimization — see
 * scripts/build-gym-leader-teams.ts) are simply weaker than Easy/Hard's real
 * meta-team pool, so a heavily-blundering AI piloting them made the mode far
 * too easy (57% flawless on a random draft at Easy-equivalent blunder rates).
 * The AI needs to play close to full strength just to give a fair fight;
 * "easier than Easy" comes from the opponents' builds, not from the AI
 * playing worse.
 *
 * Tuned via scripts/sim-gauntlet.ts (`--gl-ramp`) against a ~20% flawless
 * rate on a random draft. Deeper search (STRONG, the shipped default)
 * widens the gap in the player's favor more than FAST does — a curve tuned
 * under FAST (23% flawless, n=150) still ran ~45% under STRONG — so this is
 * calibrated against STRONG specifically (~28% flawless, n=25; noisy at that
 * sample size, but the closest of everything tried). Treat as a first pass,
 * not a settled number — re-tune with more STRONG-config runs if the real
 * flawless rate feels off.
 */
const GYMLEADER_BLUNDER = [0.08, 0.05, 0.02, 0, 0, 0];

/**
 * The opponent's policy for a given gauntlet rung. Hard fields the player's
 * own config (a full-strength mirror) every battle. Easy and Gym Leader each
 * ramp the opponent from weak-but-coherent to a fair fight — a real searcher
 * that just blunders sometimes, blundering less each battle. The two curves
 * aren't ordered the way the difficulty labels might suggest — see
 * GYMLEADER_BLUNDER above — because each is tuned against its own opponent
 * pool's real strength, not a shared notion of "blunder rate". Early rungs
 * search shallowly (FAST) under the blunders to stay cheap; the top rungs
 * use the player's own config so the ramp eases into a genuine mirror. The
 * player is always `dev.config` (STRONG by default).
 */
export function opponentPolicy(mode: DraftMode, index: number, dev: DevParams): Policy {
  const ramp = mode === 'easy' ? EASY_BLUNDER : mode === 'gymleader' ? GYMLEADER_BLUNDER : undefined;
  if (!ramp) return {kind: 'search', config: dev.config};
  const epsilon = ramp[index] ?? 0;
  if (epsilon <= 0) return {kind: 'search', config: dev.config};
  return {kind: 'mix', epsilon, config: index >= 4 ? dev.config : FAST};
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
    streamLog: true,
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
      .run([jobFor(state, index, dev)], undefined, (_jobIndex, logLines) =>
        dispatch({type: 'BATTLE_CHUNK', index, logLines})
      )
      .then(({results}) => {
        if (results[0]) dispatch({type: 'BATTLE_COMPUTED', index, result: results[0]});
      })
      .catch(error => dispatch({type: 'RUN_ERROR', index, error: String(error)}));
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
