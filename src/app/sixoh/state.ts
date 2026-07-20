import {createContext, useContext, type Dispatch} from 'react';
import type {PokemonSet} from '../../data/types';
import type {BattleResult} from '../../search/runner';
import type {DraftMode, DraftState} from '../../draft/draft';

/** Per-rung battle lifecycle. */
export type BattlePhase = 'pending' | 'computing' | 'ready' | 'replaying' | 'done';

export interface GauntletOpponent {
  name: string;
  sets: PokemonSet[];
}

export interface SixOhState {
  runSeed: number;
  mode: DraftMode;
  draft?: DraftState;
  /** Locked at Start the gauntlet. */
  team?: PokemonSet[];
  /** The 6 opponents, fixed + revealed at run start. */
  opponents: GauntletOpponent[];
  battles: Array<{phase: BattlePhase; result?: BattleResult}>;
  /** Current rung, 0..5. */
  battleIndex: number;
  record: {wins: number; losses: number};
  phase: 'draft' | 'gauntlet' | 'finished';
  outcome?: 'flawless' | 'eliminated';
  error?: string;
  /** Which rung `error` belongs to - the failure can be a prefetched rung
   * ahead of `battleIndex` (see ensureComputed), not necessarily the one
   * currently on screen. */
  errorIndex?: number;
}

export type SixOhAction =
  | {type: 'NEW_RUN'; seed: number; mode: DraftMode; draft: DraftState; opponents: GauntletOpponent[]}
  | {type: 'SET_DRAFT'; draft: DraftState}
  | {type: 'START_GAUNTLET'; team: PokemonSet[]}
  | {type: 'BATTLE_COMPUTING'; index: number}
  | {type: 'BATTLE_COMPUTED'; index: number; result: BattleResult}
  | {type: 'REPLAY_STARTED'; index: number}
  | {type: 'REPLAY_FINISHED'; index: number}
  | {type: 'RUN_ERROR'; index: number; error: string}
  | {type: 'CLEAR_ERROR'}
  | {type: 'RESET'};

export const initialSixOhState: SixOhState = {
  runSeed: 0,
  mode: 'normal',
  opponents: [],
  battles: [],
  battleIndex: 0,
  record: {wins: 0, losses: 0},
  phase: 'draft',
};

export function sixOhReducer(state: SixOhState, action: SixOhAction): SixOhState {
  switch (action.type) {
    case 'NEW_RUN':
      return {
        ...initialSixOhState,
        runSeed: action.seed,
        mode: action.mode,
        draft: action.draft,
        opponents: action.opponents,
        battles: action.opponents.map(() => ({phase: 'pending' as BattlePhase})),
      };
    case 'SET_DRAFT':
      // Keep mode in sync with the draft — switching the difficulty toggle
      // must actually change the gauntlet difficulty and the result's step-up.
      return {...state, draft: action.draft, mode: action.draft.mode};
    case 'START_GAUNTLET':
      if (!state.draft || state.draft.phase !== 'complete') return state;
      return {...state, team: action.team, phase: 'gauntlet', battleIndex: 0};
    case 'BATTLE_COMPUTING':
      return patchBattle(state, action.index, battle =>
        battle.phase === 'pending' ? {...battle, phase: 'computing'} : battle
      );
    case 'BATTLE_COMPUTED':
      return patchBattle(state, action.index, battle =>
        battle.phase === 'done' ? battle : {...battle, phase: 'ready', result: action.result}
      );
    case 'REPLAY_STARTED':
      return patchBattle(state, action.index, battle => ({...battle, phase: 'replaying'}));
    case 'REPLAY_FINISHED': {
      const battle = state.battles[action.index];
      if (!battle?.result || battle.phase === 'done') return state;
      const won = battle.result.winner === 0;
      const record = {
        wins: state.record.wins + (won ? 1 : 0),
        losses: state.record.losses + (won ? 0 : 1),
      };
      const next = patchBattle(state, action.index, b => ({...b, phase: 'done'}));
      const lastRung = action.index >= state.opponents.length - 1;
      if (!won) {
        return {...next, record, phase: 'finished', outcome: 'eliminated'};
      }
      if (lastRung) {
        return {...next, record, phase: 'finished', outcome: 'flawless'};
      }
      return {...next, record, battleIndex: action.index + 1};
    }
    case 'RUN_ERROR':
      return {...state, error: action.error, errorIndex: action.index};
    case 'CLEAR_ERROR': {
      // Retry: drop the error and reset the rung that actually failed (which
      // may be a prefetched rung ahead of battleIndex, not the on-screen one)
      // so it recomputes.
      const target = state.errorIndex ?? state.battleIndex;
      return patchBattle({...state, error: undefined, errorIndex: undefined}, target, battle => ({
        ...battle,
        phase: 'pending',
        result: undefined,
      }));
    }
    case 'RESET':
      return initialSixOhState;
  }
}

function patchBattle(
  state: SixOhState,
  index: number,
  patch: (battle: SixOhState['battles'][number]) => SixOhState['battles'][number]
): SixOhState {
  if (!state.battles[index]) return state;
  return {
    ...state,
    battles: state.battles.map((battle, i) => (i === index ? patch(battle) : battle)),
  };
}

export const SixOhStateContext = createContext<SixOhState>(initialSixOhState);
export const SixOhDispatchContext = createContext<Dispatch<SixOhAction>>(() => {});
export const useSixOhState = () => useContext(SixOhStateContext);
export const useSixOhDispatch = () => useContext(SixOhDispatchContext);
