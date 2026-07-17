import type {PokemonSet} from '../data/types';
import {BulkRunner} from '../run/bulkRunner';
import {createSimClient, type SimClient} from '../worker/client';

/**
 * Screen-independent sim session: the worker and runner must outlive route
 * changes (the user can navigate to partial results while a run streams).
 * A new/changed team recycles the worker — its run-scoped assumptions
 * (opponentKey table cache keyed off a fixed user team) die with it.
 */
let client: SimClient | undefined;
let runner: BulkRunner | undefined;
let runnerTeam: PokemonSet[] | undefined;

export function getRunner(team: PokemonSet[]): BulkRunner {
  if (!runner || runnerTeam !== team) {
    client?.terminate();
    client = createSimClient();
    runner = new BulkRunner(client, team);
    runnerTeam = team;
  }
  return runner;
}

export function cancelRun(): void {
  runner?.cancel();
}
