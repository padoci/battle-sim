/// <reference lib="webworker" />
import type {CalcTable} from '../engine/calc/table';
import {gen9} from '../data/gen';
import {resolveTable, runBattle} from '../search/runner';
import type {WorkerRequest, WorkerResponse} from './protocol';

/**
 * Long-lived simulation worker: @pkmn/dex initialization is heavy, so one
 * worker serves many jobs. All sims run here, off the main thread.
 */
const startedAt = performance.now();
const gen = gen9(); // eager: pay dex init once, measure it

const post = (message: WorkerResponse) => (self as unknown as Worker).postMessage(message);

post({type: 'ready', startupMs: performance.now() - startedAt});

const abortRequested = new Set<number>();

/**
 * Yield a macrotask so queued messages (notably 'abort') get handled
 * between battles — a synchronous loop would starve the event loop and
 * make cancellation impossible until the whole batch finished.
 */
const yieldToEventLoop = () => new Promise<void>(resolve => setTimeout(resolve, 0));

async function handleRun(id: number, jobs: Parameters<typeof runBattle>[1][]): Promise<void> {
  const start = performance.now();
  const results = [];
  // Table cache is scoped to this ONE run request on purpose: it may only
  // be keyed by opponentKey because the user team is fixed within a run.
  // Never make this worker-lifetime — a "tweak team -> re-run" would then
  // silently reuse tables built against the old user team.
  const tables = new Map<string, CalcTable>();
  try {
    for (const [index, job] of jobs.entries()) {
      if (abortRequested.delete(id)) {
        post({type: 'done', id, results, totalMs: performance.now() - start, aborted: true});
        return;
      }
      const result = runBattle(gen, job, resolveTable(tables, gen, job));
      results.push(result);
      post({type: 'progress', id, done: index + 1, total: jobs.length, result});
      await yieldToEventLoop();
    }
    post({type: 'done', id, results, totalMs: performance.now() - start});
  } catch (error) {
    post({type: 'error', id, message: String(error)});
  } finally {
    abortRequested.delete(id);
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'abort') {
    abortRequested.add(request.id);
    return;
  }
  if (request.type === 'run') {
    void handleRun(request.id, request.jobs);
  }
};
