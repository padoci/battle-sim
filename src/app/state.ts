import {createContext, useContext, type Dispatch} from 'react';
import type {PokemonSet} from '../data/types';
import type {PoolEntryConfig} from '../run/pool';
import type {RecordedBattle} from '../analysis/stats';
import type {ArchetypeResult} from '../analysis/archetype';

export type RunStatus = 'idle' | 'running' | 'done' | 'error';

export interface PoolEntryWithMeta extends PoolEntryConfig {
  archetype: ArchetypeResult;
}

export interface AppState {
  team?: {sets: PokemonSet[]; raw: string};
  pool: PoolEntryWithMeta[];
  run: {
    status: RunStatus;
    /** Optional bound: the run self-stops after this many battles. Unset = run until Stop. */
    autoStopN?: number;
    battles: RecordedBattle[];
    emaMsPerBattle: number;
    error?: string;
  };
}

export type AppAction =
  | {type: 'SET_TEAM'; sets: PokemonSet[]; raw: string}
  | {type: 'SET_POOL'; pool: PoolEntryWithMeta[]}
  | {type: 'UPDATE_POOL_ENTRY'; teamId: string; patch: Partial<Pick<PoolEntryWithMeta, 'weight' | 'enabled'>>}
  | {type: 'ADD_POOL_ENTRY'; entry: PoolEntryWithMeta}
  | {type: 'SET_AUTO_STOP'; n?: number}
  | {type: 'RUN_STATUS'; status: RunStatus; error?: string}
  | {type: 'BATTLE_DONE'; battle: RecordedBattle; emaMsPerBattle: number}
  | {type: 'RESET_RUN'};

export const initialState: AppState = {
  pool: [],
  run: {status: 'idle', battles: [], emaMsPerBattle: 0},
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_TEAM':
      // A new team invalidates prior results (never mix analyses of two teams).
      return {...state, team: {sets: action.sets, raw: action.raw}, run: {...initialState.run, autoStopN: state.run.autoStopN}};
    case 'SET_POOL':
      return {...state, pool: action.pool};
    case 'UPDATE_POOL_ENTRY':
      return {
        ...state,
        pool: state.pool.map(entry =>
          entry.teamId === action.teamId ? {...entry, ...action.patch} : entry
        ),
      };
    case 'ADD_POOL_ENTRY':
      return {...state, pool: [...state.pool, action.entry]};
    case 'SET_AUTO_STOP':
      return {...state, run: {...state.run, autoStopN: action.n}};
    case 'RUN_STATUS':
      return {...state, run: {...state.run, status: action.status, error: action.error}};
    case 'BATTLE_DONE':
      return {
        ...state,
        run: {
          ...state.run,
          battles: [...state.run.battles, action.battle],
          emaMsPerBattle: action.emaMsPerBattle,
        },
      };
    case 'RESET_RUN':
      return {...state, run: {...initialState.run, autoStopN: state.run.autoStopN}};
  }
}

export const AppStateContext = createContext<AppState>(initialState);
export const AppDispatchContext = createContext<Dispatch<AppAction>>(() => {});

export const useAppState = () => useContext(AppStateContext);
export const useAppDispatch = () => useContext(AppDispatchContext);
