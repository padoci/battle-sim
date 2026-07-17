import type {BattleJob, BattleResult} from '../search/runner';
import type {WorkerRequest, WorkerResponse} from './protocol';

export interface SimClient {
  /** Resolves once the worker has initialized (dex loaded). */
  ready: Promise<number>;
  run(
    jobs: BattleJob[],
    onProgress?: (done: number, total: number, result: BattleResult) => void
  ): Promise<{results: BattleResult[]; totalMs: number}>;
  terminate(): void;
}

/** Main-thread wrapper around the long-lived simulation worker. */
export function createSimClient(): SimClient {
  const worker = new Worker(new URL('./sim.worker.ts', import.meta.url), {type: 'module'});
  let nextId = 1;

  let readyResolve!: (ms: number) => void;
  const ready = new Promise<number>(resolve => (readyResolve = resolve));

  const pending = new Map<
    number,
    {
      resolve: (value: {results: BattleResult[]; totalMs: number}) => void;
      reject: (error: Error) => void;
      onProgress?: (done: number, total: number, result: BattleResult) => void;
    }
  >();

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
      job.resolve({results: message.results, totalMs: message.totalMs});
    } else if (message.type === 'error') {
      pending.delete(message.id);
      job.reject(new Error(message.message));
    }
  };

  return {
    ready,
    run(jobs, onProgress) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, {resolve, reject, onProgress});
        worker.postMessage({type: 'run', id, jobs} satisfies WorkerRequest);
      });
    },
    terminate() {
      worker.terminate();
    },
  };
}
