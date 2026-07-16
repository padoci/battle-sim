import type {Rng} from '../engine/rng';

/**
 * Mixed strategies for a zero-sum matrix game. `row` maximizes the payoff
 * `matrix[i][j]`, `col` minimizes it; `value` is the (approximate) game
 * value. Because the game is zero-sum, one solve yields both players'
 * equilibrium strategies (search spec §3).
 */
export interface Solution {
  row: number[];
  col: number[];
  value: number;
}

function argmax(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

function argmin(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] < values[best]) best = i;
  return best;
}

function pure(rows: number, cols: number, i: number, j: number, value: number): Solution {
  const row = new Array(rows).fill(0);
  const col = new Array(cols).fill(0);
  row[i] = 1;
  col[j] = 1;
  return {row, col, value};
}

/**
 * One pass of iterated strict-dominance elimination (to fixpoint). Returns
 * the surviving row/column indices. Guarantees a strictly dominated action
 * ends with probability exactly 0 — noise from fictitious play can't leak
 * weight onto it.
 */
function eliminateDominated(matrix: number[][]): {rows: number[]; cols: number[]} {
  let rows = matrix.map((_, i) => i);
  let cols = matrix[0].map((_, j) => j);
  let changed = true;
  while (changed) {
    changed = false;
    // Strictly dominated rows (row player maximizes).
    for (const candidate of [...rows]) {
      const dominated = rows.some(
        other =>
          other !== candidate && cols.every(j => matrix[other][j] > matrix[candidate][j])
      );
      if (dominated && rows.length > 1) {
        rows = rows.filter(i => i !== candidate);
        changed = true;
      }
    }
    // Strictly dominated columns (column player minimizes).
    for (const candidate of [...cols]) {
      const dominated = cols.some(
        other =>
          other !== candidate && rows.every(i => matrix[i][other] < matrix[i][candidate])
      );
      if (dominated && cols.length > 1) {
        cols = cols.filter(j => j !== candidate);
        changed = true;
      }
    }
  }
  return {rows, cols};
}

/**
 * Approximate Nash equilibrium of a zero-sum matrix game via fictitious
 * play (error ~O(1/sqrt(iterations)) — well under the noise floor of
 * single-sample payoff entries). Deterministic: ties break to lowest index.
 * Degenerate shapes (1xN, Nx1) short-circuit to exact pure strategies.
 */
export function solveZeroSum(matrix: number[][], iterations = 2000, epsilon = 0.03): Solution {
  const nRows = matrix.length;
  const nCols = matrix[0]?.length ?? 0;
  if (nRows === 0 || nCols === 0) throw new Error('empty payoff matrix');

  if (nRows === 1 && nCols === 1) return pure(1, 1, 0, 0, matrix[0][0]);
  if (nRows === 1) {
    const j = argmin(matrix[0]);
    return pure(1, nCols, 0, j, matrix[0][j]);
  }
  if (nCols === 1) {
    const columnValues = matrix.map(r => r[0]);
    const i = argmax(columnValues);
    return pure(nRows, 1, i, 0, matrix[i][0]);
  }

  const {rows, cols} = eliminateDominated(matrix);

  // Fictitious play on the reduced game with incremental payoff sums.
  const rowCounts = new Array(rows.length).fill(0);
  const colCounts = new Array(cols.length).fill(0);
  // rowPayoff[i] = sum over past opponent plays of matrix[rows[i]][thatCol]
  const rowPayoff = new Array(rows.length).fill(0);
  const colPayoff = new Array(cols.length).fill(0);

  let i = 0;
  let j = 0;
  for (let t = 0; t < iterations; t++) {
    rowCounts[i]++;
    colCounts[j]++;
    for (let r = 0; r < rows.length; r++) rowPayoff[r] += matrix[rows[r]][cols[j]];
    for (let c = 0; c < cols.length; c++) colPayoff[c] += matrix[rows[i]][cols[c]];
    i = argmax(rowPayoff);
    j = argmin(colPayoff);
  }

  const row = new Array(nRows).fill(0);
  const col = new Array(nCols).fill(0);
  for (let r = 0; r < rows.length; r++) row[rows[r]] = rowCounts[r] / iterations;
  for (let c = 0; c < cols.length; c++) col[cols[c]] = colCounts[c] / iterations;

  cleanup(row, epsilon);
  cleanup(col, epsilon);

  let value = 0;
  for (let r = 0; r < nRows; r++) {
    if (!row[r]) continue;
    for (let c = 0; c < nCols; c++) {
      if (col[c]) value += row[r] * col[c] * matrix[r][c];
    }
  }
  return {row, col, value};
}

/** Zero out weights below epsilon and renormalize (in place). */
function cleanup(dist: number[], epsilon: number): void {
  let total = 0;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] < epsilon) dist[i] = 0;
    total += dist[i];
  }
  if (total <= 0) {
    // Everything pruned (shouldn't happen) — fall back to uniform.
    dist.fill(1 / dist.length);
    return;
  }
  for (let i = 0; i < dist.length; i++) dist[i] /= total;
}

/** Sample an index from a distribution with the injected Rng (reproducible). */
export function sampleIndex(rng: Rng, dist: number[]): number {
  const roll = rng.next();
  let cumulative = 0;
  let last = 0;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] <= 0) continue;
    cumulative += dist[i];
    last = i;
    if (roll < cumulative) return i;
  }
  return last;
}

/**
 * Exploitability of a solution: how much each player could gain by
 * deviating to their best pure response. 0 for an exact equilibrium.
 */
export function bestResponseGap(matrix: number[][], solution: Solution): number {
  const nRows = matrix.length;
  const nCols = matrix[0].length;

  // Row player's best response value against col strategy.
  let bestRow = -Infinity;
  for (let i = 0; i < nRows; i++) {
    let v = 0;
    for (let j = 0; j < nCols; j++) v += solution.col[j] * matrix[i][j];
    bestRow = Math.max(bestRow, v);
  }
  // Column player's best response (minimizing) against row strategy.
  let bestCol = Infinity;
  for (let j = 0; j < nCols; j++) {
    let v = 0;
    for (let i = 0; i < nRows; i++) v += solution.row[i] * matrix[i][j];
    bestCol = Math.min(bestCol, v);
  }
  return Math.max(0, bestRow - solution.value) + Math.max(0, solution.value - bestCol);
}
