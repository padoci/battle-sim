import {describe, expect, it} from 'vitest';
import {bestResponseGap, sampleIndex, solveZeroSum} from '../../src/search/solve';
import {makeRng} from '../../src/engine/rng';

describe('solveZeroSum', () => {
  it('matching pennies -> uniform mix, value ~0', () => {
    const sol = solveZeroSum([
      [1, -1],
      [-1, 1],
    ]);
    for (const p of [...sol.row, ...sol.col]) expect(p).toBeCloseTo(0.5, 1);
    expect(Math.abs(sol.value)).toBeLessThan(0.1);
  });

  it('rock-paper-scissors -> thirds', () => {
    const sol = solveZeroSum([
      [0, -1, 1],
      [1, 0, -1],
      [-1, 1, 0],
    ]);
    for (const p of [...sol.row, ...sol.col]) expect(p).toBeCloseTo(1 / 3, 1);
    expect(bestResponseGap(
      [
        [0, -1, 1],
        [1, 0, -1],
        [-1, 1, 0],
      ],
      sol
    )).toBeLessThan(0.1);
  });

  it('saddle-point matrix -> exact pure strategies', () => {
    // Row 1 / Col 0 is a saddle (row maximizes): value 2.
    const matrix = [
      [1, 0, 3],
      [2, 5, 4],
    ];
    const sol = solveZeroSum(matrix);
    expect(sol.row[1]).toBe(1);
    expect(sol.col[0]).toBe(1);
    expect(sol.value).toBeCloseTo(2, 5);
  });

  it('strictly dominated actions get probability exactly 0', () => {
    // Row 2 is strictly dominated by row 0; col 2 strictly dominated by col 0.
    const matrix = [
      [5, 1, 9],
      [2, 4, 8],
      [1, 0, 7],
    ];
    const sol = solveZeroSum(matrix);
    expect(sol.row[2]).toBe(0);
    expect(sol.col[2]).toBe(0);
  });

  it('low exploitability on seeded random 8x8 matrices', () => {
    const rng = makeRng(2026);
    for (let trial = 0; trial < 10; trial++) {
      const matrix = Array.from({length: 8}, () =>
        Array.from({length: 8}, () => rng.next() * 200 - 100)
      );
      const sol = solveZeroSum(matrix, 4000, 0); // no pruning for the gap check
      expect(bestResponseGap(matrix, sol)).toBeLessThan(0.02 * 200);
    }
  });

  it('solver symmetry: solve(M) mirrors solve(-M^T)', () => {
    const rng = makeRng(7);
    const matrix = Array.from({length: 5}, () =>
      Array.from({length: 4}, () => rng.next() * 100 - 50)
    );
    const negT = matrix[0].map((_, j) => matrix.map(row => -row[j]));
    const a = solveZeroSum(matrix, 4000, 0);
    const b = solveZeroSum(negT, 4000, 0);
    for (let i = 0; i < a.row.length; i++) expect(a.row[i]).toBeCloseTo(b.col[i], 2);
    for (let j = 0; j < a.col.length; j++) expect(a.col[j]).toBeCloseTo(b.row[j], 2);
    expect(a.value).toBeCloseTo(-b.value, 1);
  });

  it('degenerate shapes: 1xN, Nx1, 1x1, all-equal', () => {
    const oneByN = solveZeroSum([[3, -2, 5]]);
    expect(oneByN.col[1]).toBe(1); // column player minimizes
    expect(oneByN.value).toBe(-2);

    const nByOne = solveZeroSum([[1], [4], [2]]);
    expect(nByOne.row[1]).toBe(1);
    expect(nByOne.value).toBe(4);

    expect(solveZeroSum([[7]]).value).toBe(7);

    const flat = solveZeroSum([
      [1, 1],
      [1, 1],
    ]);
    expect(flat.value).toBeCloseTo(1, 5);
    expect(flat.row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });
});

describe('sampleIndex', () => {
  it('matches the distribution over many draws', () => {
    const rng = makeRng(99);
    const counts = [0, 0];
    for (let i = 0; i < 10_000; i++) counts[sampleIndex(rng, [0.5, 0.5])]++;
    expect(counts[0]).toBeGreaterThan(4700);
    expect(counts[0]).toBeLessThan(5300);
  });

  it('is deterministic under a fixed seed and skips zero-weight entries', () => {
    const a = Array.from({length: 20}, () => sampleIndex(makeRng(5), [0, 0.3, 0, 0.7]));
    const b = Array.from({length: 20}, () => sampleIndex(makeRng(5), [0, 0.3, 0, 0.7]));
    expect(a).toEqual(b);
    expect(a.every(i => i === 1 || i === 3)).toBe(true);
  });
});
