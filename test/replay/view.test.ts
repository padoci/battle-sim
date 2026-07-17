import {describe, expect, it} from 'vitest';
import {applyBeat, foldBeats, initView, type ViewState} from '../../src/replay/view';
import {toBeats} from '../../src/replay/pace';
import {parseProtocol} from '../../src/replay/parse';
import {teamMemberToSet} from '../../src/data/team';
import type {Team} from '../../src/data/types';
import fixture from '../fixtures/protocol.fixture.json';
import teamsFixture from '../fixtures/teams.fixture.json';

const teams = teamsFixture as Team[];
const t1 = teams[0].data.map(teamMemberToSet);
const t2 = teams[1].data.map(teamMemberToSet);
const events = parseProtocol((fixture as {log: string[]}).log);
const beats = toBeats(events);

function stepAll(): ViewState {
  let state = initView([t1, t2]);
  for (const beat of beats) {
    const applied = applyBeat(state, beat);
    state = applied.state;
    // Invariant: hp within [0, maxhp] at every step.
    for (const side of state.sides) {
      for (const mon of side.mons) {
        expect(mon.hp).toBeGreaterThanOrEqual(0);
        expect(mon.hp).toBeLessThanOrEqual(mon.maxhp);
      }
    }
  }
  return state;
}

describe('view state over a real battle', () => {
  it('maintains hp bounds and lands on the right winner and faint count', () => {
    const final = stepAll();
    expect(final.winner).toBe((fixture as {winner: number}).winner);
    const faintEvents = events.filter(e => e.kind === 'faint').length;
    const faintedMons = final.sides.flatMap(s => s.mons.filter(m => m.fainted)).length;
    expect(faintedMons).toBe(faintEvents);
    expect(final.turn).toBe((fixture as {turns: number}).turns);
  });

  it('instant fold equals step-by-step fold', () => {
    const stepped = stepAll();
    const folded = foldBeats(initView([t1, t2]), beats, 0);
    expect(folded).toEqual(stepped);
  });

  it('damage beats yield floating-number fx with the hp delta', () => {
    let state = initView([t1, t2]);
    let sawFloat = false;
    for (const beat of beats) {
      const {state: next, fx} = applyBeat(state, beat);
      const float = fx.find(f => f.type === 'float' && f.text?.startsWith('−'));
      if (float) {
        sawFloat = true;
        expect(float.text).toMatch(/^−\d+%$/);
      }
      state = next;
    }
    expect(sawFloat).toBe(true);
  });

  it('tracks side conditions through set-up AND removal', () => {
    // Rocks go up on P1's side turn 1, then get Mortal Spin'd away later —
    // assert presence mid-battle and absence at the end.
    let state = initView([t1, t2]);
    let sawRocks = false;
    for (const beat of beats) {
      state = applyBeat(state, beat).state;
      if (state.sides[0].hazards['Stealth Rock']) sawRocks = true;
    }
    expect(sawRocks).toBe(true);
    expect(state.sides[0].hazards['Stealth Rock']).toBeUndefined();
  });

  it('accumulates the paced log', () => {
    const final = stepAll();
    expect(final.logLines.length).toBeGreaterThan(50);
    expect(final.logLines.some(l => l.includes('used'))).toBe(true);
    expect(final.logLines.some(l => l.includes('TERASTALLIZED'))).toBe(true);
  });
});
