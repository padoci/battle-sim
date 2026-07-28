import {describe, expect, it} from 'vitest';
import {BulkRunner, updateEma} from '../../src/run/bulkRunner';
import type {PoolEntryConfig} from '../../src/run/pool';
import type {BattleJob, BattleResult} from '../../src/search/runner';
import type {SimClient, RunOutcome} from '../../src/worker/client';
import type {PokemonSet} from '../../src/data/types';

/**
 * BulkRunner drives the open-ended "test your team" run and had no tests. The
 * stub client returns fabricated results instantly, so this covers the
 * orchestration — batching, the two stop paths, autoStopN arithmetic, and seed
 * derivation — in milliseconds, with no real battles.
 */

const TEAM = [{species: 'Great Tusk'}] as unknown as PokemonSet[];

function poolOf(...ids: string[]): PoolEntryConfig[] {
  return ids.map(teamId => ({teamId, teamName: teamId, team: TEAM, weight: 1, enabled: true}));
}

function fakeResult(): BattleResult {
  return {
    winner: 0,
    turns: 10,
    decisions: 10,
    nodes: 0,
    msSearch: 0,
    msTable: 0,
    msPerDecision: {mean: 0, p50: 0, p95: 0},
    nodesPerDecision: 0,
  };
}

/** Records every job it is handed and answers immediately. */
class StubClient implements SimClient {
  ready = Promise.resolve(0);
  seen: BattleJob[][] = [];
  cancelled = 0;
  /** Abort the batch that is running when this many battles have been seen. */
  abortAfter?: number;
  private total = 0;

  async run(
    jobs: BattleJob[],
    onProgress?: (done: number, total: number, result: BattleResult) => void
  ): Promise<RunOutcome> {
    this.seen.push(jobs);
    const results: BattleResult[] = [];
    for (const _job of jobs) {
      this.total++;
      if (this.abortAfter !== undefined && this.total > this.abortAfter) {
        return {results, totalMs: 1, aborted: true};
      }
      const result = fakeResult();
      results.push(result);
      onProgress?.(results.length, jobs.length, result);
    }
    return {results, totalMs: 1, aborted: false};
  }
  cancel() {
    this.cancelled++;
  }
  terminate() {}

  jobs(): BattleJob[] {
    return this.seen.flat();
  }
}

describe('BulkRunner scheduling and stop semantics', () => {
  it('runs exactly autoStopN battles and reports it did not stop early', async () => {
    const client = new StubClient();
    const outcome = await new BulkRunner(client, TEAM, 1).run(poolOf('a', 'b'), {autoStopN: 7});
    expect(outcome.battles).toHaveLength(7);
    expect(outcome.stopped).toBe(false);
    expect(client.jobs()).toHaveLength(7);
  });

  it('batches in chunks of 25 and never overshoots autoStopN', async () => {
    const client = new StubClient();
    const outcome = await new BulkRunner(client, TEAM, 1).run(poolOf('a'), {autoStopN: 60});
    expect(outcome.battles).toHaveLength(60);
    expect(client.seen.map(b => b.length)).toEqual([25, 25, 10]);
  });

  it('stops when the cancel lands MID-batch (worker reports aborted)', async () => {
    const client = new StubClient();
    client.abortAfter = 10;
    const outcome = await new BulkRunner(client, TEAM, 1).run(poolOf('a'), {autoStopN: 100});
    expect(outcome.stopped).toBe(true);
    expect(outcome.battles).toHaveLength(10);
    // The partial batch's completed results are kept, not discarded.
    expect(outcome.battles.every(b => b.result.winner === 0)).toBe(true);
  });

  it('stops when the cancel lands BETWEEN batches, where there is nothing to abort', async () => {
    const client = new StubClient();
    const runner = new BulkRunner(client, TEAM, 1);
    // Cancel during the first batch's progress callback, but let that batch
    // finish cleanly: only `stopRequested` can catch this.
    const outcome = await runner.run(poolOf('a'), {
      autoStopN: 100,
      onUpdate: update => {
        if (update.done === 25) runner.cancel();
      },
    });
    expect(outcome.stopped).toBe(true);
    expect(outcome.battles).toHaveLength(25);
    expect(client.cancelled).toBe(1);
  });

  it('reports progress once per battle with a monotonically increasing count', async () => {
    const client = new StubClient();
    const seen: number[] = [];
    await new BulkRunner(client, TEAM, 1).run(poolOf('a', 'b'), {
      autoStopN: 30,
      onUpdate: update => seen.push(update.done),
    });
    expect(seen).toHaveLength(30);
    expect(seen).toEqual(Array.from({length: 30}, (_, i) => i + 1));
  });

  it('draws opponents from the whole pool, not just the first entry', async () => {
    const client = new StubClient();
    await new BulkRunner(client, TEAM, 1).run(poolOf('a', 'b', 'c'), {autoStopN: 30});
    const opponents = new Set(client.jobs().map(j => j.opponentKey));
    expect([...opponents].sort()).toEqual(['a', 'b', 'c']);
  });

  it('names the offending team when a pool entry has no team attached', async () => {
    const runner = new BulkRunner(new StubClient(), TEAM, 1);
    // A malformed pool entry fails loudly and identifiably rather than
    // silently running the wrong opponent.
    await expect(
      runner.run([{teamId: 'ghost', teamName: 'ghost', team: undefined as never, weight: 1, enabled: true}], {
        autoStopN: 1,
      })
    ).rejects.toThrow(/unknown pool team: ghost/);
  });

  it('rejects an all-disabled pool rather than looping forever', async () => {
    const runner = new BulkRunner(new StubClient(), TEAM, 1);
    await expect(
      runner.run([{teamId: 'a', teamName: 'a', team: TEAM, weight: 0, enabled: false}], {autoStopN: 5})
    ).rejects.toThrow(/pool is empty/);
  });
});

describe('BulkRunner reproducibility', () => {
  it('derives identical job seeds from the same run seed', async () => {
    const a = new StubClient();
    const b = new StubClient();
    await new BulkRunner(a, TEAM, 12345).run(poolOf('x', 'y'), {autoStopN: 30});
    await new BulkRunner(b, TEAM, 12345).run(poolOf('x', 'y'), {autoStopN: 30});

    const seedsOf = (c: StubClient) => c.jobs().map(j => `${j.battleSeed}|${j.searchSeed}`);
    expect(seedsOf(a)).toEqual(seedsOf(b));
    expect(seedsOf(a)).toHaveLength(30);
  });

  it('produces different seeds for different run seeds', async () => {
    const a = new StubClient();
    const b = new StubClient();
    await new BulkRunner(a, TEAM, 1).run(poolOf('x'), {autoStopN: 5});
    await new BulkRunner(b, TEAM, 2).run(poolOf('x'), {autoStopN: 5});
    expect(a.jobs().map(j => j.searchSeed)).not.toEqual(b.jobs().map(j => j.searchSeed));
  });

  it('gives every battle in a run a distinct battle seed', async () => {
    const client = new StubClient();
    await new BulkRunner(client, TEAM, 99).run(poolOf('x'), {autoStopN: 50});
    const seeds = client.jobs().map(j => String(j.battleSeed));
    expect(new Set(seeds).size).toBe(50);
  });

  it('exposes the run seed so a session can be replayed from a bug report', async () => {
    expect(new BulkRunner(new StubClient(), TEAM, 4242).seed).toBe(4242);
  });
});

describe('updateEma', () => {
  it('seeds from the first sample instead of averaging against zero', () => {
    expect(updateEma(0, 500)).toBe(500);
    expect(updateEma(-1, 500)).toBe(500);
  });

  it('moves toward the latest sample without overshooting it', () => {
    const next = updateEma(100, 200, 0.2);
    expect(next).toBeGreaterThan(100);
    expect(next).toBeLessThan(200);
    expect(next).toBeCloseTo(120);
  });

  it('converges on a steady stream of identical samples', () => {
    let ema = updateEma(0, 50);
    for (let i = 0; i < 100; i++) ema = updateEma(ema, 50);
    expect(ema).toBeCloseTo(50);
  });
});
