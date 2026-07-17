import {describe, expect, it} from 'vitest';
import {initialSixOhState, sixOhReducer, type SixOhState} from '../../src/app/sixoh/state';
import type {BattleResult} from '../../src/search/runner';
import type {DraftState} from '../../src/draft/draft';

const result = (winner: 0 | 1 | null): BattleResult => ({
  winner, turns: 20, decisions: 20, nodes: 0, msSearch: 0, msTable: 0,
  msPerDecision: {mean: 0, p50: 0, p95: 0}, nodesPerDecision: 0,
});

const completeDraft = {phase: 'complete', team: []} as unknown as DraftState;

function freshRun(): SixOhState {
  let state = sixOhReducer(initialSixOhState, {
    type: 'NEW_RUN',
    seed: 1,
    mode: 'normal',
    draft: completeDraft,
    opponents: Array.from({length: 6}, (_, i) => ({name: `T${i}`, sets: []})),
  });
  state = sixOhReducer(state, {type: 'START_GAUNTLET', team: []});
  return state;
}

function playBattle(state: SixOhState, index: number, winner: 0 | 1 | null): SixOhState {
  state = sixOhReducer(state, {type: 'BATTLE_COMPUTING', index});
  state = sixOhReducer(state, {type: 'BATTLE_COMPUTED', index, result: result(winner)});
  state = sixOhReducer(state, {type: 'REPLAY_STARTED', index});
  return sixOhReducer(state, {type: 'REPLAY_FINISHED', index});
}

describe('sixOhReducer', () => {
  it('a loss at battle 3 finishes the run eliminated with a 2-1 record', () => {
    let state = freshRun();
    state = playBattle(state, 0, 0);
    state = playBattle(state, 1, 0);
    expect(state.battleIndex).toBe(2);
    state = playBattle(state, 2, 1);
    expect(state.phase).toBe('finished');
    expect(state.outcome).toBe('eliminated');
    expect(state.record).toEqual({wins: 2, losses: 1});
  });

  it('six wins is flawless', () => {
    let state = freshRun();
    for (let i = 0; i < 6; i++) state = playBattle(state, i, 0);
    expect(state.phase).toBe('finished');
    expect(state.outcome).toBe('flawless');
    expect(state.record).toEqual({wins: 6, losses: 0});
  });

  it('a draw ends the run as a non-win', () => {
    let state = freshRun();
    state = playBattle(state, 0, null);
    expect(state.phase).toBe('finished');
    expect(state.outcome).toBe('eliminated');
    expect(state.record).toEqual({wins: 0, losses: 1});
  });

  it('duplicate BATTLE_COMPUTED and REPLAY_FINISHED are no-ops (StrictMode safety)', () => {
    let state = freshRun();
    state = playBattle(state, 0, 0);
    const after = sixOhReducer(
      sixOhReducer(state, {type: 'BATTLE_COMPUTED', index: 0, result: result(1)}),
      {type: 'REPLAY_FINISHED', index: 0}
    );
    expect(after.record).toEqual(state.record);
    expect(after.battles[0].result?.winner).toBe(0);
  });

  it('START_GAUNTLET requires a complete draft; RESET clears everything', () => {
    const noDraft = sixOhReducer(initialSixOhState, {type: 'START_GAUNTLET', team: []});
    expect(noDraft.phase).toBe('draft');
    expect(sixOhReducer(freshRun(), {type: 'RESET'})).toEqual(initialSixOhState);
  });

  it('SET_DRAFT syncs mode from the draft (toggle changes gauntlet difficulty)', () => {
    const easyDraft = {phase: 'species', team: [], mode: 'easy'} as unknown as DraftState;
    const state = sixOhReducer(initialSixOhState, {type: 'SET_DRAFT', draft: easyDraft});
    expect(state.mode).toBe('easy');
    expect(state.draft).toBe(easyDraft);
  });

  it('CLEAR_ERROR clears the error and resets the current rung to pending (retry)', () => {
    let state = freshRun();
    state = sixOhReducer(state, {type: 'BATTLE_COMPUTING', index: 0});
    state = sixOhReducer(state, {type: 'RUN_ERROR', error: 'worker died'});
    expect(state.error).toBe('worker died');
    expect(state.battles[0].phase).toBe('computing');

    const cleared = sixOhReducer(state, {type: 'CLEAR_ERROR'});
    expect(cleared.error).toBeUndefined();
    expect(cleared.battles[0].phase).toBe('pending');
    expect(cleared.battles[0].result).toBeUndefined();
  });
});
