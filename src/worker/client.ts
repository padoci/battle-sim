import type {BattleJob, BattleResult} from '../search/runner';
import type {WorkerRequest, WorkerResponse} from './protocol';

export interface RunOutcome {
  results: BattleResult[];
  totalMs: number;
  /** True when the run stopped early via cancel(); results hold what finished. */
  aborted: boolean;
}

export interface SimClient {
  /** Resolves once the worker has initialized (dex loaded). */
  ready: Promise<number>;
  run(
    jobs: BattleJob[],
    onProgress?: (done: number, total: number, result: BattleResult) => void,
    /** Per-decision protocol chunks, for jobs submitted with `streamLog`. */
    onChunk?: (jobIndex: number, logLines: string[], meta: {decisions: number; turn: number}) => void
  ): Promise<RunOutcome>;
  /** Ask the in-flight run to stop at the next decision boundary (keeps the worker alive). */
  cancel(): void;
  terminate(): void;
}

/**
 * Minimal surface of `Worker` this client actually uses. Declaring it lets a
 * test drive the client with a fake, since vitest's node environment can't
 * instantiate a real module worker.
 */
export interface SimWorkerLike {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: (() => void) | null;
}

export interface SimClientOptions {
  /** Injected for tests; production uses the real module worker. */
  makeWorker?: () => SimWorkerLike;
  /**
   * Reject a run after this long with NO message of any kind for it. Deliberately
   * an idle deadline, not wall-clock: a legitimate STRONG batch takes minutes,
   * but silence means the worker is wedged and nothing will ever settle the
   * promise. Same reasoning as the stall-timeout in data/fetch.ts.
   */
  idleTimeoutMs?: number;
}

/** No progress at all for this long means the worker is wedged, not slow. */
export const DEFAULT_IDLE_TIMEOUT_MS = 120_000;

/** Main-thread wrapper around the long-lived simulation worker. */
export function createSimClient(options: SimClientOptions = {}): SimClient {
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const worker: SimWorkerLike = options.makeWorker
    ? options.makeWorker()
    : (new Worker(new URL('./sim.worker.ts', import.meta.url), {type: 'module'}) as unknown as SimWorkerLike);
  let nextId = 1;
  let inFlightId: number | null = null;
  // Set once the worker dies (failed to load, threw uncaught, or sent an
  // unparseable message) - no further message from it can be trusted, so
  // every pending and future call fails fast with this instead of hanging.
  let fatalError: Error | null = null;

  let readyResolve!: (ms: number) => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<number>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // Nobody may ever await `ready` (run() surfaces the same fatalError to its
  // own caller) - without this, a worker that fails before anyone reads
  // `ready` would log an unhandled-rejection warning.
  ready.catch(() => {});

  interface PendingRun {
    resolve: (value: RunOutcome) => void;
    reject: (error: Error) => void;
    onProgress?: (done: number, total: number, result: BattleResult) => void;
    onChunk?: (jobIndex: number, logLines: string[], meta: {decisions: number; turn: number}) => void;
    idleTimer?: ReturnType<typeof setTimeout>;
  }

  const pending = new Map<number, PendingRun>();

  /** Settle-and-forget: clears the idle timer so a settled run can't fire one. */
  function settle(id: number): PendingRun | undefined {
    const job = pending.get(id);
    if (!job) return undefined;
    if (job.idleTimer !== undefined) clearTimeout(job.idleTimer);
    pending.delete(id);
    if (inFlightId === id) inFlightId = null;
    return job;
  }

  /** Restart the silence clock — any message about a run proves it's alive. */
  function touch(id: number) {
    const job = pending.get(id);
    if (!job || idleTimeoutMs <= 0) return;
    if (job.idleTimer !== undefined) clearTimeout(job.idleTimer);
    job.idleTimer = setTimeout(() => {
      settle(id)?.reject(
        new Error(
          `sim worker stopped responding: no progress for ${Math.round(idleTimeoutMs / 1000)}s`
        )
      );
    }, idleTimeoutMs);
  }

  function fail(error: Error) {
    if (fatalError) return;
    fatalError = error;
    readyReject(error);
    inFlightId = null;
    for (const [id, job] of pending) {
      if (job.idleTimer !== undefined) clearTimeout(job.idleTimer);
      pending.delete(id);
      job.reject(error);
    }
    pending.clear();
  }

  worker.onerror = (event: ErrorEvent) => {
    fail(new Error(`sim worker error: ${event.message || 'the worker failed to load or threw uncaught'}`));
    event.preventDefault();
  };
  worker.onmessageerror = () => {
    fail(new Error('sim worker sent an unparseable message'));
  };

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (message.type === 'ready') {
      readyResolve(message.startupMs);
      return;
    }
    const job = pending.get(message.id);
    if (!job) return;
    if (message.type === 'chunk') {
      touch(message.id);
      job.onChunk?.(message.jobIndex, message.logLines, {decisions: message.decisions, turn: message.turn});
    } else if (message.type === 'progress') {
      touch(message.id);
      job.onProgress?.(message.done, message.total, message.result);
    } else if (message.type === 'done') {
      settle(message.id);
      job.resolve({results: message.results, totalMs: message.totalMs, aborted: !!message.aborted});
    } else if (message.type === 'error') {
      settle(message.id);
      job.reject(new Error(message.message));
    }
  };

  return {
    ready,
    run(jobs, onProgress, onChunk) {
      if (fatalError) return Promise.reject(fatalError);
      const id = nextId++;
      inFlightId = id;
      return new Promise((resolve, reject) => {
        pending.set(id, {resolve, reject, onProgress, onChunk});
        touch(id);
        worker.postMessage({type: 'run', id, jobs} satisfies WorkerRequest);
      });
    },
    cancel() {
      // Abort every run still in flight, not just the newest: `inFlightId`
      // alone silently leaves an older run running when two overlap.
      for (const id of pending.keys()) {
        worker.postMessage({type: 'abort', id} satisfies WorkerRequest);
      }
    },
    terminate() {
      worker.terminate();
      // A terminated worker will never answer, so every pending run must be
      // settled here or its promise hangs forever. resetSixOhSession() calls
      // terminate() on every "Draft again", which used to strand whatever
      // rung was mid-flight — including its .catch(RUN_ERROR) handler.
      fail(new Error('sim worker was terminated'));
    },
  };
}
