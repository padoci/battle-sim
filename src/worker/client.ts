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
    onProgress?: (done: number, total: number, result: BattleResult) => void
  ): Promise<RunOutcome>;
  /** Ask the in-flight run to stop after the current battle (keeps the worker alive). */
  cancel(): void;
  terminate(): void;
}

/** Main-thread wrapper around the long-lived simulation worker. */
export function createSimClient(): SimClient {
  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), {type: 'module'});
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

  const pending = new Map<
    number,
    {
      resolve: (value: RunOutcome) => void;
      reject: (error: Error) => void;
      onProgress?: (done: number, total: number, result: BattleResult) => void;
    }
  >();

  function fail(error: Error) {
    if (fatalError) return;
    fatalError = error;
    readyReject(error);
    inFlightId = null;
    for (const job of pending.values()) job.reject(error);
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
    if (message.type === 'progress') {
      job.onProgress?.(message.done, message.total, message.result);
    } else if (message.type === 'done') {
      pending.delete(message.id);
      if (inFlightId === message.id) inFlightId = null;
      job.resolve({results: message.results, totalMs: message.totalMs, aborted: !!message.aborted});
    } else if (message.type === 'error') {
      pending.delete(message.id);
      if (inFlightId === message.id) inFlightId = null;
      job.reject(new Error(message.message));
    }
  };

  return {
    ready,
    run(jobs, onProgress) {
      if (fatalError) return Promise.reject(fatalError);
      const id = nextId++;
      inFlightId = id;
      return new Promise((resolve, reject) => {
        pending.set(id, {resolve, reject, onProgress});
        worker.postMessage({type: 'run', id, jobs} satisfies WorkerRequest);
      });
    },
    cancel() {
      if (inFlightId !== null) {
        worker.postMessage({type: 'abort', id: inFlightId} satisfies WorkerRequest);
      }
    },
    terminate() {
      worker.terminate();
    },
  };
}
