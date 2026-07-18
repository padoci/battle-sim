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

describe('typed move FX (category + type flavor)', () => {
  const mkBeat = (events: Parameters<typeof applyBeat>[1]['events']) => ({events, durationMs: 0});
  const moveEvent = (
    move: string,
    side: 0 | 1 = 0,
    tags: Record<string, boolean> = {}
  ) => ({kind: 'move' as const, ref: {side, name: 'X'}, move, tags, logText: ''});

  it('attaches type and category (Flamethrower -> Fire / Special)', () => {
    const {fx} = applyBeat(initView([t1, t2]), mkBeat([moveEvent('Flamethrower')]));
    const lunge = fx.find(f => f.type === 'lunge')!;
    const impact = fx.find(f => f.type === 'impact')!;
    expect(lunge.moveType).toBe('Fire');
    expect(lunge.category).toBe('Special');
    expect(impact.moveType).toBe('Fire');
    expect(impact.side).toBe(1);
  });

  it('status moves glow on the user only — no defender impact', () => {
    const {fx} = applyBeat(initView([t1, t2]), mkBeat([moveEvent('Swords Dance')]));
    expect(fx).toHaveLength(1);
    expect(fx[0]).toMatchObject({type: 'lunge', side: 0, category: 'Status'});
  });

  it('misses and immunities still suppress the impact', () => {
    const {fx} = applyBeat(initView([t1, t2]), mkBeat([moveEvent('Flamethrower', 0, {miss: true})]));
    expect(fx.some(f => f.type === 'impact')).toBe(false);
    expect(fx.some(f => f.type === 'lunge')).toBe(true);
  });

  it('unknown move names degrade gracefully (fx without type, no throw)', () => {
    const {fx} = applyBeat(initView([t1, t2]), mkBeat([moveEvent('Notarealmove')]));
    const lunge = fx.find(f => f.type === 'lunge')!;
    expect(lunge.moveType).toBeUndefined();
    expect(fx.some(f => f.type === 'impact')).toBe(true); // unknown != status
  });
});

describe('switch-in FX', () => {
  const switchEvent = (side: 0 | 1, name: string, species: string) => ({
    kind: 'switch' as const,
    ref: {side, name},
    species,
    hp: 100,
    maxhp: 100,
    drag: false,
    logText: '',
  });

  it('is suppressed for the initial lead placement (turn 0)', () => {
    const state = initView([t1, t2]);
    const {fx} = applyBeat(state, {events: [switchEvent(0, t1[0].species, t1[0].species)], durationMs: 0});
    expect(fx.some(f => f.type === 'switch')).toBe(false);
  });

  it('fires for a mid-battle switch (after turn 1)', () => {
    let state = initView([t1, t2]);
    state = applyBeat(state, {events: [{kind: 'turn', turn: 1}], durationMs: 0}).state;
    const {fx} = applyBeat(state, {events: [switchEvent(0, t1[1].species, t1[1].species)], durationMs: 0});
    expect(fx.some(f => f.type === 'switch' && f.side === 0)).toBe(true);
  });
});
