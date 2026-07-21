import type {Battle} from '@pkmn/sim';
import {makeJointChoice, reseed, restore, snapshot, winner, type BattleSnapshot} from '../engine/battle';
import {toChoice, type Action} from '../engine/actions';
import {extractState} from '../engine/snapshot';
import {ensureFresh, type CalcTable} from '../engine/calc/table';
import {evaluate} from '../engine/eval';
import type {Rng} from '../engine/rng';
import {interiorCandidates, rootCandidates} from './candidates';
import type {SearchConfig} from './config';
import {forkSeed} from './fork';
import {sampleIndex, solveZeroSum, type Solution} from './solve';

/** Terminal bonus keeping "win healthy" preferred over "win barely". */
const WIN_SCORE = 10_000;

/** Everything the search saw and decided for one turn (log rendering, tests). */
export interface TurnTrace {
  turn: number;
  /** Root candidate actions per side. */
  actions: [Action[], Action[]];
  /** Human-readable labels for the candidates (move ids / switch targets). */
  labels: [string[], string[]];
  /** Payoff matrix from P1's perspective: matrix[i][j]. */
  matrix: number[][];
  solution: Solution;
  /** Sampled indices into the candidate lists. */
  chosen: [number, number];
  /** Sim transitions performed for this decision. */
  nodes: number;
  ms: number;
}

interface SearchContext {
  table: CalcTable;
  cfg: SearchConfig;
  searchSeed: number;
  turn: number;
  nodes: number;
}

function terminalValue(battle: Battle): number | null {
  if (!battle.ended) return null;
  const w = winner(battle);
  if (w === null) return 0; // tie
  return w === 0 ? WIN_SCORE : -WIN_SCORE;
}

/** Fork-seed stride between independent `samplesPerCell` draws of the same
 *  cell — must exceed any single draw's largest interior offset
 *  (1 + interiorCandidates^2) so samples never share a branch's RNG. */
const SAMPLE_STRIDE = 1000;

/**
 * Value (P1 pov) of one root matrix cell: step the joint action on a
 * re-seeded branch; at depth 1 evaluate; at depth 2 expand an m x m
 * pessimistic interior and aggregate by the saddle midpoint
 * (maxmin + minmax)/2 — exactly antisymmetric under pov swap, brackets the
 * true value, equals it whenever the interior has a saddle point.
 *
 * `cfg.samplesPerCell` independent chance-resolutions of the SAME cell are
 * averaged to smooth the noise from one unlucky/lucky RNG roll (miss, crit,
 * proc) standing in for the whole distribution; samplesPerCell=1 (the
 * shipped default) is exactly the original single-draw behavior.
 */
function cellValue(ctx: SearchContext, snap: BattleSnapshot, i: number, j: number, a: Action, b: Action): number {
  const samples = Math.max(1, ctx.cfg.samplesPerCell);
  let total = 0;
  for (let s = 0; s < samples; s++) {
    total += cellValueSample(ctx, snap, i, j, a, b, s * SAMPLE_STRIDE);
  }
  return total / samples;
}

function cellValueSample(
  ctx: SearchContext,
  snap: BattleSnapshot,
  i: number,
  j: number,
  a: Action,
  b: Action,
  sampleBase: number
): number {
  const branch = restore(snap);
  reseed(branch, forkSeed(ctx.searchSeed, ctx.turn, i, j, sampleBase));
  makeJointChoice(branch, toChoice(a), toChoice(b));
  ctx.nodes++;

  const terminal = terminalValue(branch);
  const state = extractState(branch);
  if (terminal !== null) return terminal + evaluate(state, ctx.table, 0, 0);
  if (ctx.cfg.depth === 1) {
    return evaluate(state, ctx.table, 0, ctx.cfg.matchupWeightByDepth[0]);
  }

  // Depth 2: interior layer.
  const aCands = interiorCandidates(branch, 0, state, ctx.table, ctx.cfg);
  const bCands = interiorCandidates(branch, 1, state, ctx.table, ctx.cfg);
  const innerSnap = snapshot(branch);
  const inner: number[][] = [];
  for (let u = 0; u < aCands.length; u++) {
    inner.push([]);
    for (let v = 0; v < bCands.length; v++) {
      const leafBranch = restore(innerSnap);
      reseed(leafBranch, forkSeed(ctx.searchSeed, ctx.turn, i, j, sampleBase + 1 + u * bCands.length + v));
      makeJointChoice(leafBranch, toChoice(aCands[u]), toChoice(bCands[v]));
      ctx.nodes++;
      const leafTerminal = terminalValue(leafBranch);
      const leafState = extractState(leafBranch);
      inner[u].push(
        leafTerminal !== null
          ? leafTerminal + evaluate(leafState, ctx.table, 0, 0)
          : evaluate(leafState, ctx.table, 0, ctx.cfg.matchupWeightByDepth[1])
      );
    }
  }
  return saddleMidpoint(inner);
}

/** (max_u min_v + min_v max_u) / 2 over an interior payoff matrix. */
export function saddleMidpoint(matrix: number[][]): number {
  let maxmin = -Infinity;
  for (const row of matrix) {
    maxmin = Math.max(maxmin, Math.min(...row));
  }
  let minmax = Infinity;
  for (let j = 0; j < matrix[0].length; j++) {
    let colMax = -Infinity;
    for (let i = 0; i < matrix.length; i++) colMax = Math.max(colMax, matrix[i][j]);
    minmax = Math.min(minmax, colMax);
  }
  return (maxmin + minmax) / 2;
}

/** Human-readable label for an action, resolved against the live battle. */
function labelAction(battle: Battle, side: 0 | 1, action: Action): string {
  const pokemon = battle.sides[side].pokemon;
  if (action.kind === 'move') {
    const active = pokemon.find(p => p.isActive);
    const id = active?.moveSlots[action.slot - 1]?.id ?? `move ${action.slot}`;
    return action.tera ? `${id}+tera` : id;
  }
  if (action.kind === 'switch') {
    return `switch ${pokemon[action.slot - 1]?.species.id ?? action.slot}`;
  }
  return 'pass';
}

function buildRootMatrix(
  battle: Battle,
  ctx: SearchContext
): {actions: [Action[], Action[]]; labels: [string[], string[]]; matrix: number[][]} {
  const state = extractState(battle);
  ensureFresh(ctx.table, state);
  const aCands = rootCandidates(battle, 0, state, ctx.table, ctx.cfg);
  const bCands = rootCandidates(battle, 1, state, ctx.table, ctx.cfg);
  const snap = snapshot(battle);

  const matrix: number[][] = [];
  for (let i = 0; i < aCands.length; i++) {
    matrix.push([]);
    for (let j = 0; j < bCands.length; j++) {
      matrix[i].push(cellValue(ctx, snap, i, j, aCands[i], bCands[j]));
    }
  }
  return {
    actions: [aCands, bCands],
    labels: [
      aCands.map(a => labelAction(battle, 0, a)),
      bCands.map(a => labelAction(battle, 1, a)),
    ],
    matrix,
  };
}

function decide(
  battle: Battle,
  ctx: SearchContext,
  rng1: Rng,
  rng2: Rng
): {c1: string; c2: string; trace: TurnTrace} {
  const start = performance.now();
  const {actions, labels, matrix} = buildRootMatrix(battle, ctx);
  const solution = solveZeroSum(matrix, ctx.cfg.solverIterations, ctx.cfg.epsilonPrune);
  const i = sampleIndex(rng1, solution.row);
  const j = sampleIndex(rng2, solution.col);
  return {
    c1: toChoice(actions[0][i]),
    c2: toChoice(actions[1][j]),
    trace: {
      turn: battle.turn,
      actions,
      labels,
      matrix,
      solution,
      chosen: [i, j],
      nodes: ctx.nodes,
      ms: performance.now() - start,
    },
  };
}

/**
 * Symmetric self-play decision: ONE equilibrium solve per turn, both sides'
 * actions sampled (independently) from it. This is equilibrium self-play —
 * not foresight — and halves search cost (search spec §3/§8).
 */
export function chooseTurn(
  battle: Battle,
  table: CalcTable,
  cfg: SearchConfig,
  rng1: Rng,
  rng2: Rng,
  searchSeed: number
): {c1: string; c2: string; trace: TurnTrace} {
  const ctx: SearchContext = {table, cfg, searchSeed, turn: battle.turn, nodes: 0};
  return decide(battle, ctx, rng1, rng2);
}

/**
 * One side's decision under its own config (asymmetric matchups like d2 vs
 * d1). Models the opponent with the same config — a deliberate v1
 * simplification; the opponent's actual policy samples its own solve.
 */
export function chooseAction(
  battle: Battle,
  side: 0 | 1,
  table: CalcTable,
  cfg: SearchConfig,
  rng: Rng,
  searchSeed: number
): {choice: string; trace: TurnTrace} {
  const ctx: SearchContext = {table, cfg, searchSeed: searchSeed ^ (side * 0x55aa55), turn: battle.turn, nodes: 0};
  const start = performance.now();
  const {actions, labels, matrix} = buildRootMatrix(battle, ctx);
  const solution = solveZeroSum(matrix, cfg.solverIterations, cfg.epsilonPrune);
  const dist = side === 0 ? solution.row : solution.col;
  const index = sampleIndex(rng, dist);
  return {
    choice: toChoice(actions[side][index]),
    trace: {
      turn: battle.turn,
      actions,
      labels,
      matrix,
      solution,
      chosen: side === 0 ? [index, -1] : [-1, index],
      nodes: ctx.nodes,
      ms: performance.now() - start,
    },
  };
}
