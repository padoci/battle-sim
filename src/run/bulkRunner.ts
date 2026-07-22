import type {PokemonSet} from '../data/types';
import {randomSeed} from '../engine/rng';
import {FAST} from '../search/config';
import type {BattleJob, BattleResult} from '../search/runner';
import type {SimClient} from '../worker/client';
import {drawSchedule, initSwrr, type PoolEntryConfig, type SwrrState} from './pool';

/** Battles per worker batch. Small enough that Stop lands within one batch
 * boundary even if the in-flight cancel is missed; large enough that batch
 * overhead is noise. */
const RUN_CHUNK = 25;

/** EMA update for live throughput re-estimation from actual battle times. */
export function updateEma(previous: number, latestMs: number, alpha = 0.2): number {
  return previous <= 0 ? latestMs : alpha * latestMs + (1 - alpha) * previous;
}

export interface RunUpdate {
  teamId: string;
  result: BattleResult;
  done: number;
  emaMsPerBattle: number;
}

export interface BulkRunOutcome {
  battles: Array<{teamId: string; result: BattleResult}>;
  /** True when the run ended via Stop rather than reaching an auto-stop bound. */
  stopped: boolean;
}

/**
 * Orchestrates one test-your-team session's battles as an open-ended run:
 * batches drawn from ONE smooth-weighted-round-robin schedule (so any stop
 * point stays representative of the pool mix), continuing until `cancel()`
 * or the optional `autoStopN` bound. Progress streams via `onUpdate` so the
 * live dashboard fills battle by battle; stopping keeps everything run so
 * far analyzable.
 */
export class BulkRunner {
  private swrr: SwrrState | null = null;
  private teamsById = new Map<string, PokemonSet[]>();
  private battleIndex = 0;
  private emaMsPerBattle = 0;
  private lastProgressAt = 0;
  private stopRequested = false;

  constructor(
    private readonly client: SimClient,
    private readonly userTeam: PokemonSet[],
    private readonly searchSeed: number = Math.floor(Math.random() * 2 ** 31)
  ) {}

  /** Live per-battle wall-clock EMA; 0 before the first battle completes. */
  get msPerBattle(): number {
    return this.emaMsPerBattle;
  }

  private buildJobs(teamIds: string[]): BattleJob[] {
    return teamIds.map(teamId => {
      const team = this.teamsById.get(teamId);
      if (!team) throw new Error(`unknown pool team: ${teamId}`);
      const index = this.battleIndex++;
      return {
        teams: [this.userTeam, team] as BattleJob['teams'],
        battleSeed: randomSeed(),
        searchSeed: this.searchSeed + index * 7919,
        policies: [
          {kind: 'search', config: FAST},
          {kind: 'search', config: FAST},
        ],
        maxTurns: 200,
        collectStats: true,
        opponentKey: teamId,
      };
    });
  }

  private async runBatch(
    teamIds: string[],
    doneOffset: number,
    onUpdate?: (update: RunUpdate) => void
  ): Promise<{battles: BulkRunOutcome['battles']; aborted: boolean}> {
    const jobs = this.buildJobs(teamIds);
    this.lastProgressAt = performance.now();
    const outcome = await this.client.run(jobs, (done, _total, result) => {
      const now = performance.now();
      this.emaMsPerBattle = updateEma(this.emaMsPerBattle, now - this.lastProgressAt);
      this.lastProgressAt = now;
      onUpdate?.({
        teamId: teamIds[done - 1],
        result,
        done: doneOffset + done,
        emaMsPerBattle: this.emaMsPerBattle,
      });
    });
    return {
      battles: outcome.results.map((result, i) => ({teamId: teamIds[i], result})),
      aborted: outcome.aborted,
    };
  }

  /**
   * Run until `cancel()` or (when set) `autoStopN` battles. The scheduler
   * re-inits from `pool` at the start of every run, so weight/enabled edits
   * made between runs always take effect.
   */
  async run(
    pool: PoolEntryConfig[],
    opts: {autoStopN?: number; onUpdate?: (update: RunUpdate) => void} = {}
  ): Promise<BulkRunOutcome> {
    for (const entry of pool) this.teamsById.set(entry.teamId, entry.team);
    this.swrr = initSwrr(pool);
    this.stopRequested = false;

    const battles: BulkRunOutcome['battles'] = [];
    for (;;) {
      const want = opts.autoStopN ? Math.min(RUN_CHUNK, opts.autoStopN - battles.length) : RUN_CHUNK;
      if (want <= 0) return {battles, stopped: false};
      const batch = await this.runBatch(drawSchedule(this.swrr, want), battles.length, opts.onUpdate);
      battles.push(...batch.battles);
      // Both checks matter: `aborted` covers a cancel that landed mid-batch,
      // `stopRequested` covers one that landed in the gap between batches
      // (where there is no in-flight worker run for cancel() to abort).
      if (batch.aborted || this.stopRequested) return {battles, stopped: true};
      if (opts.autoStopN && battles.length >= opts.autoStopN) return {battles, stopped: false};
    }
  }

  cancel(): void {
    this.stopRequested = true;
    this.client.cancel();
  }
}
