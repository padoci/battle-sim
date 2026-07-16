import {describe, expect, it} from 'vitest';
import {gen9} from '../../src/data/gen';
import {createBattle, makeJointChoice} from '../../src/engine/battle';
import {extractState, type MonState} from '../../src/engine/snapshot';
import {buildCalcTable} from '../../src/engine/calc/table';
import {seedFromInts} from '../../src/engine/rng';
import {hazardFrac, interiorCandidates, rootCandidates} from '../../src/search/candidates';
import {FAST} from '../../src/search/config';
import {fixtureTeams, makeSet} from '../engine/helpers';

const gen = gen9();

function monStub(overrides: Partial<MonState>): MonState {
  return {
    slot: 0,
    speciesId: 'kingambit',
    hp: 100,
    maxhp: 100,
    fainted: false,
    boosts: {atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0},
    status: '',
    volatiles: [],
    itemId: '',
    abilityId: '',
    teraType: '',
    terastallized: false,
    spe: 100,
    moveIds: [],
    isActive: false,
    ...overrides,
  };
}

describe('hazardFrac', () => {
  const noHazards = {stealthrock: false, spikes: 0 as const, toxicspikes: 0 as const, stickyweb: false};

  it('Heavy-Duty Boots -> 0 regardless of hazards', () => {
    const mon = monStub({speciesId: 'volcarona', itemId: 'heavydutyboots'});
    expect(hazardFrac(gen, mon, {...noHazards, stealthrock: true, spikes: 3})).toBe(0);
  });

  it('SR scales with rock effectiveness (4x weak = 50%)', () => {
    expect(hazardFrac(gen, monStub({speciesId: 'volcarona'}), {...noHazards, stealthrock: true})).toBeCloseTo(0.5, 10); // Bug/Fire 4x
    expect(hazardFrac(gen, monStub({speciesId: 'slowkinggalar'}), {...noHazards, stealthrock: true})).toBeCloseTo(0.125, 10); // Poison/Psychic neutral
    expect(hazardFrac(gen, monStub({speciesId: 'kingambit'}), {...noHazards, stealthrock: true})).toBeCloseTo(0.0625, 10); // Steel resists
    expect(hazardFrac(gen, monStub({speciesId: 'greattusk'}), {...noHazards, stealthrock: true})).toBeCloseTo(0.03125, 10); // double resist
  });

  it('spikes ignore flyers/levitators/balloons, scale with layers', () => {
    expect(hazardFrac(gen, monStub({speciesId: 'dragonite'}), {...noHazards, spikes: 3})).toBe(0); // Flying
    expect(hazardFrac(gen, monStub({speciesId: 'gholdengo', abilityId: 'levitate'}), {...noHazards, spikes: 2})).toBe(0);
    expect(hazardFrac(gen, monStub({speciesId: 'kingambit', itemId: 'airballoon'}), {...noHazards, spikes: 1})).toBe(0);
    expect(hazardFrac(gen, monStub({speciesId: 'kingambit'}), {...noHazards, spikes: 1})).toBeCloseTo(1 / 8, 10);
    expect(hazardFrac(gen, monStub({speciesId: 'kingambit'}), {...noHazards, spikes: 3})).toBeCloseTo(1 / 4, 10);
  });
});

describe('rootCandidates / interiorCandidates', () => {
  const [team1, team2] = fixtureTeams();
  const table = buildCalcTable(gen, [team1, team2]);

  function freshBattle() {
    return createBattle({p1: {team: team1}, p2: {team: team2}, seed: seedFromInts(4, 3, 2, 1)});
  }

  it('root: all moves + capped tera variants + at most K switches', () => {
    const battle = freshBattle();
    const state = extractState(battle);
    const actions = rootCandidates(battle, 0, state, table, FAST);

    const moves = actions.filter(a => a.kind === 'move' && !a.tera);
    const tera = actions.filter(a => a.kind === 'move' && a.tera);
    const switches = actions.filter(a => a.kind === 'switch');
    expect(moves).toHaveLength(4);
    expect(tera.length).toBeLessThanOrEqual(FAST.rootTeraVariants);
    expect(switches.length).toBeLessThanOrEqual(FAST.rootSwitchK);
    expect(actions.length).toBeLessThanOrEqual(4 + FAST.rootTeraVariants + FAST.rootSwitchK);
  });

  it('interior: never contains tera variants, capped at m', () => {
    const battle = freshBattle();
    const state = extractState(battle);
    for (const side of [0, 1] as const) {
      const actions = interiorCandidates(battle, side, state, table, FAST);
      expect(actions.length).toBeLessThanOrEqual(FAST.interiorCandidates);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.some(a => a.kind === 'move' && a.tera)).toBe(false);
    }
  });

  it('turn-1 root candidates mirror exactly under side swap', () => {
    const battleA = freshBattle();
    const battleB = createBattle({p1: {team: team2}, p2: {team: team1}, seed: seedFromInts(4, 3, 2, 1)});
    const tableB = buildCalcTable(gen, [team2, team1]);
    const stateA = extractState(battleA);
    const stateB = extractState(battleB);
    expect(rootCandidates(battleA, 0, stateA, table, FAST)).toEqual(
      rootCandidates(battleB, 1, stateB, tableB, FAST)
    );
    expect(rootCandidates(battleA, 1, stateA, table, FAST)).toEqual(
      rootCandidates(battleB, 0, stateB, tableB, FAST)
    );
  });

  it('a clearly losing switch is pruned; a KO-threat pivot is kept', () => {
    // P1 active Chansey (wall) with bench: Kingambit (Kowtow Cleave 2x on
    // Gholdengo — real pivot) and a level-5 fodder mon Gholdengo OHKOs
    // with zero threat back (clearly worse than staying, beyond the margin).
    const p1 = [
      makeSet('Chansey', ['Seismic Toss', 'Soft-Boiled'], {ability: 'Natural Cure', item: 'Eviolite'}),
      makeSet('Kingambit', ['Kowtow Cleave', 'Sucker Punch', 'Swords Dance', 'Iron Head'], {
        ability: 'Supreme Overlord',
        evs: {hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252},
      }),
      makeSet('Blissey', ['Seismic Toss', 'Soft-Boiled'], {ability: 'Natural Cure', level: 5}),
    ];
    const p2 = [
      makeSet('Gholdengo', ['Shadow Ball', 'Make It Rain', 'Recover', 'Nasty Plot'], {
        ability: 'Good as Gold',
        evs: {hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252},
      }),
    ];
    const battle = createBattle({p1: {team: p1}, p2: {team: p2}, seed: seedFromInts(1, 1, 1, 1)});
    const table2 = buildCalcTable(gen, [p1, p2]);
    const state = extractState(battle);
    const actions = rootCandidates(battle, 0, state, table2, FAST);
    const switchSlots = actions.filter(a => a.kind === 'switch').map(a => (a as {slot: number}).slot);
    expect(switchSlots).toContain(2); // Kingambit pivot (slot 2)
    expect(switchSlots).not.toContain(3); // level-5 fodder: OHKOed, no threat
  });

  it('forced switches return every legal switch unpruned', () => {
    // Faint P1's Chansey vs a strong attacker, then check the request.
    const p1 = [
      makeSet('Chansey', ['Seismic Toss'], {ability: 'Natural Cure', level: 5}),
      makeSet('Kingambit', ['Sucker Punch'], {ability: 'Supreme Overlord'}),
      makeSet('Blissey', ['Seismic Toss'], {ability: 'Natural Cure'}),
    ];
    const p2 = [makeSet('Gholdengo', ['Make It Rain'], {ability: 'Good as Gold'})];
    const battle = createBattle({p1: {team: p1}, p2: {team: p2}, seed: seedFromInts(2, 2, 2, 2)});
    const table2 = buildCalcTable(gen, [p1, p2]);
    let guard = 0;
    while (!(battle.sides[0].activeRequest as {forceSwitch?: unknown})?.forceSwitch && guard++ < 10) {
      makeJointChoice(battle, 'move 1', 'move 1');
    }
    const state = extractState(battle);
    const actions = rootCandidates(battle, 0, state, table2, FAST);
    expect(actions.every(a => a.kind === 'switch')).toBe(true);
    expect(actions).toHaveLength(2); // both healthy bench mons
  });
});
