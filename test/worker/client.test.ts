import {afterEach, describe, expect, it, vi} from 'vitest';
import {createSimClient, type SimWorkerLike} from '../../src/worker/client';
import type {BattleJob, BattleResult} from '../../src/search/runner';
import type {WorkerRequest, WorkerResponse} from '../../src/worker/protocol';

/**
 * The worker client had no tests at all — `test/client.test.ts` is the DATA
 * client, not this one. Everything here is about one property: **every run()
 * promise settles**. A promise that never settles is the worst failure mode
 * this app has, because there is no server and no telemetry: the UI just
 * spins and the user reloads.
 */

class FakeWorker implements SimWorkerLike {
  sent: WorkerRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;

  postMessage(message: WorkerRequest) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }

  /** Drive a response into the client as the real worker would. */
  emit(response: WorkerResponse) {
    this.onmessage?.({data: response} as MessageEvent<WorkerResponse>);
  }
  emitError(message: string) {
    this.onerror?.({message, preventDefault() {}} as ErrorEvent);
  }
  aborts() {
    return this.sent.filter(m => m.type === 'abort').map(m => m.id);
  }
}

function setup(idleTimeoutMs?: number) {
  const worker = new FakeWorker();
  const client = createSimClient({makeWorker: () => worker, idleTimeoutMs});
  return {worker, client};
}

const JOBS = [] as BattleJob[];
const RESULT = {winner: 0, turns: 10} as BattleResult;

afterEach(() => {
  vi.useRealTimers();
});

describe('SimClient message routing', () => {
  it('resolves ready on the ready message', async () => {
    const {worker, client} = setup();
    worker.emit({type: 'ready', startupMs: 42});
    await expect(client.ready).resolves.toBe(42);
  });

  it('routes done/progress/chunk to the right run when two overlap', async () => {
    const {worker, client} = setup();
    const progressA: number[] = [];
    const progressB: number[] = [];
    const a = client.run(JOBS, done => progressA.push(done));
    const b = client.run(JOBS, done => progressB.push(done));

    worker.emit({type: 'progress', id: 2, done: 1, total: 1, result: RESULT});
    worker.emit({type: 'progress', id: 1, done: 7, total: 9, result: RESULT});
    worker.emit({type: 'done', id: 1, results: [RESULT], totalMs: 5});
    worker.emit({type: 'done', id: 2, results: [], totalMs: 3});

    await expect(a).resolves.toMatchObject({results: [RESULT], totalMs: 5, aborted: false});
    await expect(b).resolves.toMatchObject({results: [], totalMs: 3});
    expect(progressA).toEqual([7]);
    expect(progressB).toEqual([1]);
  });

  it('ignores messages for an unknown or already-settled run', async () => {
    const {worker, client} = setup();
    const run = client.run(JOBS);
    worker.emit({type: 'done', id: 1, results: [], totalMs: 1});
    await run;
    // A late duplicate must not throw or double-settle.
    expect(() => worker.emit({type: 'done', id: 1, results: [], totalMs: 1})).not.toThrow();
    expect(() => worker.emit({type: 'progress', id: 99, done: 1, total: 1, result: RESULT})).not.toThrow();
  });
});

describe('SimClient failure paths — every promise settles', () => {
  it('rejects ready, all pending runs, and all future runs when the worker dies', async () => {
    const {worker, client} = setup();
    const a = client.run(JOBS);
    const b = client.run(JOBS);
    worker.emitError('boom');

    await expect(client.ready).rejects.toThrow(/boom/);
    await expect(a).rejects.toThrow(/boom/);
    await expect(b).rejects.toThrow(/boom/);
    await expect(client.run(JOBS)).rejects.toThrow(/boom/);
  });

  it('rejects an in-flight run when the worker is terminated', async () => {
    // resetSixOhSession() calls terminate() on every "Draft again". Without
    // this, a rung mid-flight strands its promise and its RUN_ERROR handler
    // never fires — a silent leak per restart.
    const {worker, client} = setup();
    const run = client.run(JOBS);
    client.terminate();

    expect(worker.terminated).toBe(true);
    await expect(run).rejects.toThrow(/terminated/);
  });

  it('rejects a run that goes completely silent, instead of hanging forever', async () => {
    vi.useFakeTimers();
    const {client} = setup(1000);
    const run = client.run(JOBS);
    run.catch(() => {}); // settle the rejection before we assert on it
    vi.advanceTimersByTime(1001);
    await expect(run).rejects.toThrow(/stopped responding/);
  });

  it('does not time out a run that is slow but still reporting progress', async () => {
    vi.useFakeTimers();
    const {worker, client} = setup(1000);
    const run = client.run(JOBS);
    // A legitimate STRONG batch: minutes long, but never silent.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(900);
      worker.emit({type: 'progress', id: 1, done: i + 1, total: 10, result: RESULT});
    }
    worker.emit({type: 'done', id: 1, results: [RESULT], totalMs: 9000});
    await expect(run).resolves.toMatchObject({results: [RESULT]});
  });

  it('does not fire a timeout for an already-settled run', async () => {
    vi.useFakeTimers();
    const {worker, client} = setup(1000);
    const run = client.run(JOBS);
    worker.emit({type: 'done', id: 1, results: [], totalMs: 1});
    await expect(run).resolves.toBeDefined();
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });
});

describe('SimClient cancel', () => {
  it('aborts every in-flight run, not only the most recent', async () => {
    const {worker, client} = setup();
    const a = client.run(JOBS);
    const b = client.run(JOBS);
    client.cancel();

    expect(worker.aborts().sort()).toEqual([1, 2]);
    worker.emit({type: 'done', id: 1, results: [], totalMs: 1, aborted: true});
    worker.emit({type: 'done', id: 2, results: [], totalMs: 1, aborted: true});
    await expect(a).resolves.toMatchObject({aborted: true});
    await expect(b).resolves.toMatchObject({aborted: true});
  });

  it('is a no-op when nothing is in flight', () => {
    const {worker, client} = setup();
    expect(() => client.cancel()).not.toThrow();
    expect(worker.aborts()).toEqual([]);
  });
});
