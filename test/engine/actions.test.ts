import {describe, expect, it} from 'vitest';
import {createBattle, makeJointChoice} from '../../src/engine/battle';
import {legalActions, toChoice, type Action} from '../../src/engine/actions';
import {seedFromInts} from '../../src/engine/rng';
import {makeSet} from './helpers';

const SEED = seedFromInts(9, 9, 9, 9);

const p1Team = [
  makeSet('Clodsire', ['Stealth Rock', 'Toxic', 'Curse', 'Recover'], {ability: 'Water Absorb'}),
  makeSet('Blissey', ['Seismic Toss', 'Soft-Boiled'], {ability: 'Natural Cure'}),
  makeSet('Great Tusk', ['Headlong Rush', 'Rapid Spin'], {ability: 'Protosynthesis'}),
];
const p2Team = [
  makeSet('Whimsicott', ['Leech Seed', 'Substitute', 'Tailwind', 'Moonblast'], {
    ability: 'Prankster',
  }),
  makeSet('Dragonite', ['Extreme Speed', 'Earthquake', 'Outrage', 'Fire Punch'], {
    ability: 'Multiscale',
    item: 'Choice Band',
  }),
  makeSet('Kingambit', ['Sucker Punch', 'Iron Head'], {ability: 'Supreme Overlord'}),
];

function fresh() {
  return createBattle({p1: {team: p1Team}, p2: {team: p2Team}, seed: SEED});
}

const moves = (actions: Action[]) => actions.filter(a => a.kind === 'move');
const switches = (actions: Action[]) => actions.filter(a => a.kind === 'switch');

describe('legalActions', () => {
  it('offers moves (with tera variants) plus switches on a normal turn', () => {
    const battle = fresh();
    const actions = legalActions(battle, 0);
    // 4 moves x {plain, tera} + 2 healthy benched switches
    expect(moves(actions)).toHaveLength(8);
    expect(moves(actions).filter(a => a.kind === 'move' && a.tera)).toHaveLength(4);
    expect(switches(actions)).toEqual([
      {kind: 'switch', slot: 2},
      {kind: 'switch', slot: 3},
    ]);
  });

  it('every emitted choice string is accepted under strictChoices', () => {
    for (const side of [0, 1] as const) {
      for (const action of legalActions(fresh(), side)) {
        const battle = fresh();
        const c = toChoice(action);
        const other = side === 0 ? 'default' : c;
        expect(() => makeJointChoice(battle, side === 0 ? c : 'default', other)).not.toThrow();
      }
    }
  });

  it('drops tera variants once the side has terastallized', () => {
    const battle = fresh();
    makeJointChoice(battle, 'move 1 terastallize', 'move 4');
    const actions = legalActions(battle, 0);
    expect(moves(actions).some(a => a.kind === 'move' && a.tera)).toBe(false);
    // Opponent still can.
    expect(moves(legalActions(battle, 1)).some(a => a.kind === 'move' && a.tera)).toBe(true);
  });

  it('excludes choice-locked (disabled) moves', () => {
    const battle = fresh();
    // Dragonite (Choice Band) locks into Extreme Speed.
    makeJointChoice(battle, 'move 4', 'switch 2');
    makeJointChoice(battle, 'move 4', 'move 1');
    const actions = legalActions(battle, 1);
    expect(moves(actions).map(a => (a.kind === 'move' ? a.slot : 0))).toEqual([1, 1]); // plain + tera
  });

  it('offers only switches on forceSwitch, and pass to the waiting side', () => {
    const battle = fresh();
    // Blissey (2 attacking-move slots only) vs Kingambit until one faints.
    makeJointChoice(battle, 'switch 2', 'switch 3');
    let guard = 0;
    while (!battle.sides.some(s => (s.activeRequest as {forceSwitch?: unknown})?.forceSwitch) && guard++ < 100) {
      makeJointChoice(battle, 'move 1', 'move 2');
    }
    const forced = battle.sides.findIndex(
      s => (s.activeRequest as {forceSwitch?: unknown})?.forceSwitch
    ) as 0 | 1;
    const waiting = (1 - forced) as 0 | 1;
    expect(legalActions(battle, forced).every(a => a.kind === 'switch')).toBe(true);
    expect(legalActions(battle, forced).length).toBeGreaterThan(0);
    expect(legalActions(battle, waiting)).toEqual([{kind: 'pass'}]);
    // And the combination is accepted by the sim.
    const c = toChoice(legalActions(battle, forced)[0]);
    expect(() =>
      makeJointChoice(battle, forced === 0 ? c : '', forced === 0 ? '' : c)
    ).not.toThrow();
  });
});

describe('toChoice', () => {
  it('formats all action kinds', () => {
    expect(toChoice({kind: 'move', slot: 2})).toBe('move 2');
    expect(toChoice({kind: 'move', slot: 3, tera: true})).toBe('move 3 terastallize');
    expect(toChoice({kind: 'switch', slot: 5})).toBe('switch 5');
    expect(toChoice({kind: 'pass'})).toBe('');
  });
});
