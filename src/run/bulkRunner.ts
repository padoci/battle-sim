import type {PokemonSet} from '../data/types';
import {randomSeed} from '../engine/rng';
import {FAST} from '../search/config';
import type {BattleJob, BattleResult} from '../search/runner';
import type {SimClient} from '../worker/client';
import {CALIBRATION_BATTLES, medianMs, updateEma} from './calibration';
import {drawSchedule, initSwrr, type PoolEntryConfig, type SwrrState} from './pool';

export interface RunUpdate {
  teamId: string;
  result: BattleResult;
  done: number;
  planned: number;
  emaMsPerBattle: number;
}

export interface BulkRunOutcome {
  battles: Array<{teamId: string; result: BattleResult}>;
  aborted: boolean;
}

/**
 * Orchestrates one test-your-team session's battles: a calibration batch
 * first (counted toward the total), then the remaining battles up to the
 * user's chosen N — all drawn from ONE smooth-weighted-round-robin schedule
 * so any prefix stays representative of the pool mix. Progress streams via
 * `onUpdate` so the dashboard fills progressively; `cancel()` stops after
 * the in-flight battle and keeps partial results analyzable.
 */
export class BulkRunner {
  private swrr: SwrrState | null = null;
  private teamsById = new Map<string, PokemonSet[]>();
  private battleIndex = 0;
  private emaMsPerBattle = 0;
  private lastProgressAt = 0;

  constructor(
    private readonly client: SimClient,
    private readonly userTeam: PokemonSet[],
    private readonly searchSeed: number = Math.floor(Math.random() * 2 ** 31)
  ) {}

  /** Per-battle wall-clock median from calibration; 0 before calibrate(). */
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
    plannedTotal: number,
    doneOffset: number,
    onUpdate?: (update: RunUpdate) => void
  ): Promise<BulkRunOutcome> {
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
        planned: plannedTotal,
        emaMsPerBattle: this.emaMsPerBattle,
      });
    });
    return {
      battles: outcome.results.map((result, i) => ({teamId: teamIds[i], result})),
      aborted: outcome.aborted,
    };
  }

  /**
   * Run the ~10-battle calibration slice (drawn from the same schedule that
   * the full run continues). Returns the battles + measured median ms.
   */
  async calibrate(
    pool: PoolEntryConfig[],
    onUpdate?: (update: RunUpdate) => void
  ): Promise<BulkRunOutcome & {msPerBattleP50: number}> {
    for (const entry of pool) this.teamsById.set(entry.teamId, entry.team);
    this.swrr = initSwrr(pool);
    const count = Math.min(CALIBRATION_BATTLES, Math.max(1, pool.filter(p => p.enabled && p.weight > 0).length * 3));

    const startedAt = performance.now();
    const perBattleMs: number[] = [];
    let last = startedAt;
    const outcome = await this.runBatch(drawSchedule(this.swrr, count), count, 0, update => {
      const now = performance.now();
      perBattleMs.push(now - last);
      last = now;
      onUpdate?.(update);
    });
    const p50 = medianMs(perBattleMs);
    this.emaMsPerBattle = p50;
    return {...outcome, msPerBattleP50: p50};
  }

  /**
   * Continue the same schedule up to `totalN` battles overall (calibration
   * included). `reweightedPool` re-inits the scheduler for the REMAINING
   * picks only (already-run battles stay as they were).
   */
  async extend(
    totalN: number,
    doneSoFar: number,
    onUpdate?: (update: RunUpdate) => void,
    reweightedPool?: PoolEntryConfig[]
  ): Promise<BulkRunOutcome> {
    if (reweightedPool) {
      for (const entry of reweightedPool) this.teamsById.set(entry.teamId, entry.team);
      this.swrr = initSwrr(reweightedPool);
    }
    if (!this.swrr) throw new Error('calibrate() must run first');
    const remaining = Math.max(0, totalN - doneSoFar);
    if (remaining === 0) return {battles: [], aborted: false};
    return this.runBatch(drawSchedule(this.swrr, remaining), totalN, doneSoFar, onUpdate);
  }

  cancel(): void {
    this.client.cancel();
  }
}
