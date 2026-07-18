import {afterEach, describe, expect, it} from 'vitest';
import {gen9} from '../../src/data/gen';
import {buildCalcTable} from '../../src/engine/calc/table';
import {evaluate, setEvalOverrides, statusMoveValue, threat, weightedStatusMoveValue, WEIGHTS} from '../../src/engine/eval';
import type {BattleState, MonState, SideState} from '../../src/engine/snapshot';
import {fixtureTeams} from './helpers';

const gen = gen9();
const [team1, team2] = fixtureTeams();
const table = buildCalcTable(gen, [team1, team2]);

function mon(speciesId: string, overrides: Partial<MonState> = {}): MonState {
  return {
    slot: 0,
    speciesId,
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
    isActive: true,
    ...overrides,
  };
}

function side(mons: MonState[], overrides: Partial<SideState> = {}): SideState {
  return {
    mons,
    activeIndex: Math.max(0, mons.findIndex(m => m.isActive)),
    hazards: {stealthrock: false, spikes: 0, toxicspikes: 0, stickyweb: false},
    screens: {reflect: false, lightscreen: false, auroraveil: false},
    tailwind: false,
    safeguard: false,
    teraUsed: false,
    ...overrides,
  };
}

function fullState(p1: SideState, p2: SideState): BattleState {
  return {sides: [p1, p2], weather: '', terrain: '', trickRoom: false, turn: 1};
}

afterEach(() => setEvalOverrides(undefined));

describe('statusMoveValue — direction and immunities', () => {
  const bench = (n: number) => Array.from({length: n}, (_, i) => mon('gliscor', {slot: i + 1, isActive: false}));

  it('Will-O-Wisp: valuable vs a healthy target, dead vs statused or Fire-types', () => {
    const atk = mon('gliscor');
    const kingambit = mon('kingambit');
    const defSide = side([kingambit]);
    expect(statusMoveValue(table, 0, atk, 'willowisp', kingambit, defSide)).toBeGreaterThan(0.29);
    expect(statusMoveValue(table, 0, atk, 'willowisp', mon('kingambit', {status: 'brn'}), defSide)).toBe(0);
    expect(statusMoveValue(table, 0, atk, 'willowisp', mon('heatran'), side([mon('heatran')]))).toBe(0);
  });

  it('Thunder Wave: pays when the defender is faster; blocked by Ground/Electric', () => {
    const atk = mon('kingambit', {spe: 100});
    const fast = mon('darkrai', {spe: 250});
    const slow = mon('dondozo', {spe: 40});
    expect(statusMoveValue(table, 0, atk, 'thunderwave', fast, side([fast]))).toBeCloseTo(0.45, 5);
    expect(statusMoveValue(table, 0, atk, 'thunderwave', slow, side([slow]))).toBeCloseTo(0.15, 5);
    expect(statusMoveValue(table, 0, atk, 'thunderwave', mon('tinglu'), side([mon('tinglu')]))).toBe(0); // Ground
  });

  it('Toxic: blocked by Steel/Poison types', () => {
    const atk = mon('gliscor');
    expect(statusMoveValue(table, 0, atk, 'toxic', mon('kingambit'), side([mon('kingambit')]))).toBe(0); // Steel
    expect(statusMoveValue(table, 0, atk, 'toxic', mon('dragapult'), side([mon('dragapult')]))).toBeCloseTo(0.35, 5);
  });

  it('Stealth Rock: scales with opposing living reserves, worthless once up', () => {
    const atk = mon('tinglu');
    const active = mon('gliscor');
    const five = side([active, ...bench(5)]);
    const one = side([active, ...bench(1)]);
    const up = side([active, ...bench(5)], {hazards: {stealthrock: true, spikes: 0, toxicspikes: 0, stickyweb: false}});
    expect(statusMoveValue(table, 0, atk, 'stealthrock', active, five)).toBeCloseTo(0.6, 5);
    expect(statusMoveValue(table, 0, atk, 'stealthrock', active, one)).toBeCloseTo(0.12, 5);
    expect(statusMoveValue(table, 0, atk, 'stealthrock', active, up)).toBe(0);
  });

  it('setup moves count only while healthy', () => {
    const def = mon('gliscor');
    const defSide = side([def]);
    expect(statusMoveValue(table, 0, mon('kingambit'), 'swordsdance', def, defSide)).toBeCloseTo(0.25, 5);
    expect(statusMoveValue(table, 0, mon('kingambit', {hp: 20}), 'swordsdance', def, defSide)).toBe(0);
  });
});

describe('threat — status awareness (max over actions, override-gated)', () => {
  it('weightedStatusMoveValue applies the (overridable) scalar; 0 restores blindness', () => {
    const atk = mon('darkrai');
    const def = mon('gliscor');
    const defSide = side([def]);
    const raw = statusMoveValue(table, 0, atk, 'willowisp', def, defSide);
    expect(raw).toBeGreaterThan(0);
    expect(weightedStatusMoveValue(table, 0, atk, 'willowisp', def, defSide)).toBeCloseTo(
      WEIGHTS.STATUS_THREAT * raw,
      8
    );
    setEvalOverrides({statusThreatWeight: 0});
    expect(weightedStatusMoveValue(table, 0, atk, 'willowisp', def, defSide)).toBe(0);
  });

  it('threat with a status move in the kit is never below the status-blind read', () => {
    // Glimmora's fixture kit carries Stealth Rock (real moveIds correspondence).
    const glimmora = mon('glimmora', {
      moveIds: ['earthpower', 'mortalspin', 'powergem', 'stealthrock'],
    });
    const def = mon('dondozo');
    const defSide = side([def, ...Array.from({length: 5}, (_, i) => mon('gliscor', {slot: i + 1, isActive: false}))]);
    setEvalOverrides({statusThreatWeight: 0});
    const blind = threat(table, 0, glimmora, def, defSide, {weather: ''});
    setEvalOverrides(undefined);
    const aware = threat(table, 0, glimmora, def, defSide, {weather: ''});
    expect(aware).toBeGreaterThanOrEqual(blind);
  });
});

describe('evaluate — new terms', () => {
  const ids1 = team1.map(s => gen.species.get(s.species)!.id as string);
  const ids2 = team2.map(s => gen.species.get(s.species)!.id as string);
  const mk = (ids: string[], sets: typeof team1, boost: Partial<MonState> = {}) =>
    ids.map((id, i) =>
      mon(id, {
        slot: i,
        isActive: i === 0,
        moveIds: sets[i].moves.map(m => gen.moves.get(m)!.id as string),
        ...(i === 0 ? boost : {}),
      })
    );

  it('zeroed overrides restore the old eval exactly (no term contributions)', () => {
    const boosted = fullState(
      side(mk(ids1, team1)),
      side(mk(ids2, team2, {boosts: {atk: 2, def: 0, spa: 2, spd: 0, spe: 2, accuracy: 0, evasion: 0}}))
    );
    setEvalOverrides({statusThreatWeight: 0, sweeperDangerWeight: 0, speedTierWeight: 0});
    const zeroed = evaluate(boosted, table, 0);
    // The danger term can only subtract from the threatened side; with it on,
    // the same state must score the pov side no higher.
    setEvalOverrides(undefined);
    expect(evaluate(boosted, table, 0)).toBeLessThanOrEqual(zeroed);
  });

  it('sweeper danger punishes an opposing +6/+6 active (and only via the term)', () => {
    const menace = fullState(
      side(mk(ids1, team1)),
      side(mk(ids2, team2, {boosts: {atk: 6, def: 0, spa: 6, spd: 0, spe: 6, accuracy: 0, evasion: 0}}))
    );
    setEvalOverrides({sweeperDangerWeight: 0});
    const off = evaluate(menace, table, 0);
    setEvalOverrides(undefined);
    const on = evaluate(menace, table, 0);
    expect(on).toBeLessThan(off);
  });

  it('speed-tier term rewards a team that outspeeds the opposing active', () => {
    const speedy = fullState(
      side(mk(ids1, team1).map(m => ({...m, spe: 300}))),
      side(mk(ids2, team2).map(m => ({...m, spe: 50})))
    );
    setEvalOverrides({speedTierWeight: 0});
    const off = evaluate(speedy, table, 0);
    setEvalOverrides({speedTierWeight: 5});
    const on = evaluate(speedy, table, 0);
    // 6 of mine outspeed their active; none of theirs outspeed mine: +6 net.
    expect(on - off).toBeCloseTo(30, 5);
  });

  it('stays zero-sum with all new terms active on a messy state', () => {
    const messy = fullState(
      side(mk(ids1, team1, {boosts: {atk: 2, def: 0, spa: 0, spd: 0, spe: 1, accuracy: 0, evasion: 0}})),
      side(mk(ids2, team2, {boosts: {atk: 0, def: 0, spa: 4, spd: 0, spe: 2, accuracy: 0, evasion: 0}}), {
        hazards: {stealthrock: true, spikes: 1, toxicspikes: 0, stickyweb: false},
      })
    );
    expect(evaluate(messy, table, 0)).toBeCloseTo(-evaluate(messy, table, 1), 8);
  });
});
