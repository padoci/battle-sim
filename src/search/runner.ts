import type {Generation} from '@pkmn/data';
import type {PokemonSet} from '../data/types';
import {createBattle, isOver, makeJointChoice, winner} from '../engine/battle';
import {setEvalOverrides, type EvalOverrides} from '../engine/eval';
import {legalActions, toChoice} from '../engine/actions';
import {buildCalcTable, type CalcTable} from '../engine/calc/table';
import {extractState} from '../engine/snapshot';
import {makeRng, pick, type Rng, type Seed} from '../engine/rng';
import type {SearchConfig} from './config';
import {chooseAction, chooseTurn, type TurnTrace} from './search';
import {emptyStats, recordTurn, type BattleStats} from './stats';

/**
 * How a side chooses its move:
 * - `search`: full policy at the given config (the real AI).
 * - `random`: a uniform legal move (the baseline / a "fish").
 * - `mix`: a competent `search` player that blunders into a random move with
 *   probability `epsilon` — a tunable "weak but coherent" opponent. epsilon 0
 *   is pure search, epsilon 1 is pure random; values between give a smooth
 *   difficulty dial (used to ramp Easy-mode opponents without a cliff).
 */
export type Policy =
  | {kind: 'search'; config: SearchConfig}
  | {kind: 'random'}
  | {kind: 'mix'; epsilon: number; config: SearchConfig};

export interface BattleJob {
  teams: [PokemonSet[], PokemonSet[]];
  battleSeed: Seed;
  searchSeed: number;
  policies: [Policy, Policy];
  /** Decision cap; hitting it scores a draw (winner null). Default 300. */
  maxTurns?: number;
  collectTrace?: boolean;
  collectLog?: boolean;
  /** Record structured per-battle stats (faints, damage tally, speed race). */
  collectStats?: boolean;
  /**
   * Stable opponent identity for CalcTable reuse across a bulk run's
   * battles. Only meaningful while the OTHER team stays fixed for the whole
   * run (a run-scoped cache) — see resolveTable.
   */
  opponentKey?: string;
  /** Stream per-decision log chunks from the worker ('chunk' messages).
   * Consumed by sim.worker only; inert for direct runBattle callers. */
  streamLog?: boolean;
  /** Dev-only eval tuning knobs (e.g. the gauntlet's ?tera=N). */
  evalOverrides?: EvalOverrides;
  /**
   * Per-side eval overrides for A/B strength tests (e.g. new Tera eval vs old).
   * When set, each side searches under its own worldview and the symmetric
   * fast path is disabled. Falls back to `evalOverrides` for an unset side.
   */
  evalOverridesBySide?: [EvalOverrides | undefined, EvalOverrides | undefined];
}

export interface BattleResult {
  winner: 0 | 1 | null;
  turns: number;
  decisions: number;
  nodes: number;
  msSearch: number;
  msTable: number;
  msPerDecision: {mean: number; p50: number; p95: number};
  nodesPerDecision: number;
  trace?: TurnTrace[];
  protocolLog?: string[];
  stats?: BattleStats;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function samePolicies(policies: [Policy, Policy]): boolean {
  const [a, b] = policies;
  return (
    a.kind === 'search' && b.kind === 'search' && JSON.stringify(a.config) === JSON.stringify(b.config)
  );
}

function randomChoice(battle: Parameters<typeof legalActions>[0], side: 0 | 1, rng: Rng): string {
  return toChoice(pick(rng, legalActions(battle, side)));
}

/**
 * Get (or build and cache) the CalcTable for a job's `opponentKey`.
 * The cache MUST be scoped to one batch/run where the user team is fixed:
 * it is keyed by opponent identity alone, so reusing it across runs with a
 * different first team would silently serve stale tables.
 */
export function resolveTable(
  cache: Map<string, CalcTable>,
  gen: Generation,
  job: BattleJob
): CalcTable | undefined {
  if (!job.opponentKey) return undefined;
  let table = cache.get(job.opponentKey);
  if (!table) {
    table = buildCalcTable(gen, job.teams);
    cache.set(job.opponentKey, table);
  }
  return table;
}

/** One decision boundary's worth of new root-battle protocol log. */
export interface BattleStep {
  /** Lines appended to battle.log since the previous step. Step 0 is the
   * pre-decision prelude (players, lead switch-ins, |turn|1). */
  logLines: string[];
  /** Decisions completed so far (0 for the prelude step). */
  decisions: number;
  turn: number;
}

/**
 * Run one AI-vs-AI battle to completion, yielding at every decision
 * boundary. Deterministic given the job's seeds; `runBattle` below is the
 * synchronous drain of this generator, so both share one implementation.
 * Yield boundaries are exactly `makeChoices` boundaries, which is what makes
 * incremental re-parsing of the accumulated log safe (a |split| trio or a
 * move and its consequence lines never straddle a step).
 */
export function* runBattleSteps(
  gen: Generation,
  job: BattleJob,
  table?: CalcTable
): Generator<BattleStep, BattleResult> {
  // Applied unconditionally: a job WITHOUT overrides must clear any prior
  // battle's overrides in the long-lived worker.
  setEvalOverrides(job.evalOverrides);
  const tableStart = performance.now();
  const calcTable = table ?? buildCalcTable(gen, job.teams);
  const msTable = table ? 0 : performance.now() - tableStart;

  const battle = createBattle({
    p1: {team: job.teams[0]},
    p2: {team: job.teams[1]},
    seed: job.battleSeed,
  });

  const maxTurns = job.maxTurns ?? 300;
  // Per-side eval overrides force the asymmetric path (each side needs its own
  // eval worldview, which the joint chooseTurn cannot express).
  const symmetric = samePolicies(job.policies) && !job.evalOverridesBySide;
  const rng1 = makeRng(job.searchSeed ^ 0x1111);
  const rng2 = makeRng(job.searchSeed ^ 0x2222);

  const traces: TurnTrace[] = [];
  const decisionMs: number[] = [];
  const stats = job.collectStats ? emptyStats() : undefined;
  let nodes = 0;
  let decisions = 0;
  // Streaming cursor into battle.log; only the ROOT battle's log is read
  // here (search branches strip theirs), so it grows monotonically.
  let streamStart = 0;

  // Prelude step: createBattle already emitted the player/lead/turn-1 lines,
  // which is everything the stage needs to show the send-outs while the
  // FIRST search decision (below) is still computing.
  yield {logLines: battle.log.slice(0), decisions: 0, turn: battle.turn};
  streamStart = battle.log.length;

  try {
    while (!isOver(battle) && decisions < maxTurns) {
      const statePrev = stats ? extractState(battle) : undefined;
      const logStart = stats ? battle.log.length : 0;
      let c1: string;
      let c2: string;

      if (symmetric && job.policies[0].kind === 'search') {
        const decision = chooseTurn(battle, calcTable, job.policies[0].config, rng1, rng2, job.searchSeed);
        c1 = decision.c1;
        c2 = decision.c2;
        decisionMs.push(decision.trace.ms);
        nodes += decision.trace.nodes;
        if (job.collectTrace) traces.push(decision.trace);
      } else {
        const choose = (side: 0 | 1): string => {
          const policy = job.policies[side];
          const rng = side === 0 ? rng1 : rng2;
          if (policy.kind === 'random') return randomChoice(battle, side, rng);
          // A mix player blunders into a random legal move with prob epsilon.
          // The epsilon>0 guard short-circuits the draw so mix(0) consumes no
          // RNG and is bit-for-bit identical to plain search.
          if (policy.kind === 'mix' && policy.epsilon > 0 && rng.next() < policy.epsilon) {
            return randomChoice(battle, side, rng);
          }
          // Apply this side's eval worldview for the search (A/B tests).
          if (job.evalOverridesBySide) setEvalOverrides(job.evalOverridesBySide[side] ?? job.evalOverrides);
          const decision = chooseAction(battle, side, calcTable, policy.config, rng, job.searchSeed);
          decisionMs.push(decision.trace.ms);
          nodes += decision.trace.nodes;
          if (job.collectTrace) traces.push(decision.trace);
          return decision.choice;
        };
        c1 = choose(0);
        c2 = choose(1);
      }

      makeJointChoice(battle, c1, c2);
      decisions++;
      if (stats && statePrev) {
        recordTurn(stats, statePrev, extractState(battle), battle.log.slice(logStart), battle.turn);
      }
      yield {logLines: battle.log.slice(streamStart), decisions, turn: battle.turn};
      streamStart = battle.log.length;
    }
  } catch (error) {
    throw new Error(
      `battle failed (battleSeed=${String(job.battleSeed)} searchSeed=${job.searchSeed} turn=${battle.turn}): ${String(error)}`,
      {cause: error}
    );
  }

  const sorted = [...decisionMs].sort((a, b) => a - b);
  const msSearch = decisionMs.reduce((a, b) => a + b, 0);
  return {
    winner: isOver(battle) ? winner(battle) : null,
    turns: battle.turn,
    decisions,
    nodes,
    msSearch,
    msTable,
    msPerDecision: {
      mean: decisionMs.length ? msSearch / decisionMs.length : 0,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
    },
    nodesPerDecision: decisions ? nodes / decisions : 0,
    ...(job.collectTrace ? {trace: traces} : {}),
    ...(job.collectLog ? {protocolLog: [...battle.log]} : {}),
    ...(stats ? {stats} : {}),
  };
}

/**
 * Run one AI-vs-AI battle to completion. Deterministic given the job's
 * seeds. This is the API the worker and the Stage 3 bulk sim reuse; it is
 * the synchronous drain of runBattleSteps, so streamed and non-streamed
 * runs are the same computation.
 */
export function runBattle(gen: Generation, job: BattleJob, table?: CalcTable): BattleResult {
  const steps = runBattleSteps(gen, job, table);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

/**
 * Run a batch sequentially, invoking `onEach` after every battle. Jobs
 * carrying an `opponentKey` share one CalcTable per key for the batch.
 */
export function runBattles(
  gen: Generation,
  jobs: BattleJob[],
  onEach?: (result: BattleResult, index: number) => void
): BattleResult[] {
  const tables = new Map<string, CalcTable>();
  const results: BattleResult[] = [];
  for (const [index, job] of jobs.entries()) {
    const result = runBattle(gen, job, resolveTable(tables, gen, job));
    results.push(result);
    onEach?.(result, index);
  }
  return results;
}
