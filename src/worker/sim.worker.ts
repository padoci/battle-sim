/// <reference lib="webworker" />
import {gen9} from '../data/gen';
import {runBattle} from '../search/runner';
import type {WorkerRequest, WorkerResponse} from './protocol';

/**
 * Long-lived simulation worker: @pkmn/dex initialization is heavy, so one
 * worker serves many jobs. All sims run here, off the main thread.
 */
const startedAt = performance.now();
const gen = gen9(); // eager: pay dex init once, measure it

const post = (message: WorkerResponse) => (self as unknown as Worker).postMessage(message);

post({type: 'ready', startupMs: performance.now() - startedAt});

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'run') return;
  const start = performance.now();
  try {
    const results = [];
    for (const [index, job] of request.jobs.entries()) {
      const result = runBattle(gen, job);
      results.push(result);
      post({type: 'progress', id: request.id, done: index + 1, total: request.jobs.length, result});
    }
    post({type: 'done', id: request.id, results, totalMs: performance.now() - start});
  } catch (error) {
    post({type: 'error', id: request.id, message: String(error)});
  }
};
