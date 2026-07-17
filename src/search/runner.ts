import type {Generation} from '@pkmn/data';
import type {PokemonSet} from '../data/types';
import {createBattle, isOver, makeJointChoice, winner} from '../engine/battle';
import {legalActions, toChoice} from '../engine/actions';
import {buildCalcTable, type CalcTable} from '../engine/calc/table';
import {makeRng, pick, type Rng, type Seed} from '../engine/rng';
import type {SearchConfig} from './config';
import {chooseAction, chooseTurn, type TurnTrace} from './search';

export type Policy = {kind: 'search'; config: SearchConfig} | {kind: 'random'};

export interface BattleJob {
  teams: [PokemonSet[], PokemonSet[]];
  battleSeed: Seed;
  searchSeed: number;
  policies: [Policy, Policy];
  /** Decision cap; hitting it scores a draw (winner null). Default 300. */
  maxTurns?: number;
  collectTrace?: boolean;
  collectLog?: boolean;
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
 * Run one AI-vs-AI battle to completion. Deterministic given the job's
 * seeds. This is the API the worker and the Stage 3 bulk sim reuse.
 */
export function runBattle(gen: Generation, job: BattleJob, table?: CalcTable): BattleResult {
  const tableStart = performance.now();
  const calcTable = table ?? buildCalcTable(gen, job.teams);
  const msTable = table ? 0 : performance.now() - tableStart;

  const battle = createBattle({
    p1: {team: job.teams[0]},
    p2: {team: job.teams[1]},
    seed: job.battleSeed,
  });

  const maxTurns = job.maxTurns ?? 300;
  const symmetric = samePolicies(job.policies);
  const rng1 = makeRng(job.searchSeed ^ 0x1111);
  const rng2 = makeRng(job.searchSeed ^ 0x2222);

  const traces: TurnTrace[] = [];
  const decisionMs: number[] = [];
  let nodes = 0;
  let decisions = 0;

  try {
    while (!isOver(battle) && decisions < maxTurns) {
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
  };
}

/** Run a batch sequentially, invoking `onEach` after every battle. */
export function runBattles(
  gen: Generation,
  jobs: BattleJob[],
  onEach?: (result: BattleResult, index: number) => void
): BattleResult[] {
  const results: BattleResult[] = [];
  for (const [index, job] of jobs.entries()) {
    const result = runBattle(gen, job);
    results.push(result);
    onEach?.(result, index);
  }
  return results;
}
