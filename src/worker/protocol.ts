import type {BattleJob, BattleResult} from '../search/runner';

/** Messages into the sim worker. All payloads are structured-clone-safe. */
export type WorkerRequest = {type: 'run'; id: number; jobs: BattleJob[]};

/** Messages out of the sim worker. */
export type WorkerResponse =
  | {type: 'ready'; startupMs: number}
  | {type: 'progress'; id: number; done: number; total: number; result: BattleResult}
  | {type: 'done'; id: number; results: BattleResult[]; totalMs: number}
  | {type: 'error'; id: number; message: string};
