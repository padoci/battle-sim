/// <reference lib="webworker" />
import type {CalcTable} from '../engine/calc/table';
import {gen9} from '../data/gen';
import {resolveTable, runBattleSteps} from '../search/runner';
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
 * between decisions — a synchronous loop would starve the event loop and
 * make cancellation impossible until the whole batch finished. Uses a
 * MessageChannel rather than setTimeout(0): nested timeouts get clamped to
 * ~4ms after a few levels, and at one yield PER DECISION that clamp would
 * add ~600ms of dead time to a 150-decision battle.
 */
const yieldChannel = new MessageChannel();
let yieldResolve: (() => void) | undefined;
yieldChannel.port1.onmessage = () => yieldResolve?.();
const yieldToEventLoop = () =>
  new Promise<void>(resolve => {
    yieldResolve = resolve;
    yieldChannel.port2.postMessage(null);
  });

async function handleRun(id: number, jobs: Parameters<typeof runBattleSteps>[1][]): Promise<void> {
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
      // Drive the battle one decision at a time, yielding between decisions
      // so an abort can land MID-battle (the partial battle is discarded —
      // `results` only ever holds completed battles, same contract as
      // before). Streaming jobs additionally post each decision's log chunk.
      const steps = runBattleSteps(gen, job, resolveTable(tables, gen, job));
      let next = steps.next(); // prelude (leads placed, no search yet)
      while (!next.done) {
        if (job.streamLog && next.value.logLines.length) {
          post({type: 'chunk', id, jobIndex: index, ...next.value});
        }
        await yieldToEventLoop();
        if (abortRequested.delete(id)) {
          post({type: 'done', id, results, totalMs: performance.now() - start, aborted: true});
          return;
        }
        next = steps.next(); // the next search decision (the expensive part)
      }
      const result = next.value; // loop exit ⇒ done ⇒ the BattleResult
      results.push(result);
      post({type: 'progress', id, done: index + 1, total: jobs.length, result});
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
