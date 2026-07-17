import {describe, expect, it} from 'vitest';
import {gen9} from '../../src/data/gen';
import {buildCalcTable} from '../../src/engine/calc/table';
import {evaluate, evaluatePokemon, WEIGHTS} from '../../src/engine/eval';
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
    isActive: false,
    ...overrides,
  };
}

function side(mons: MonState[], overrides: Partial<SideState> = {}): SideState {
  return {
    mons,
    activeIndex: mons.findIndex(m => m.isActive),
    hazards: {stealthrock: false, spikes: 0, toxicspikes: 0, stickyweb: false},
    screens: {reflect: false, lightscreen: false, auroraveil: false},
    tailwind: false,
    safeguard: false,
    teraUsed: false,
    ...overrides,
  };
}

/** Symmetric two-side state built from the fixture teams' species ids. */
function balancedState(
  p1Overrides: Partial<SideState> = {},
  p2Overrides: Partial<SideState> = {}
): BattleState {
  const ids1 = team1.map(s => gen.species.get(s.species)!.id as string);
  const ids2 = team2.map(s => gen.species.get(s.species)!.id as string);
  const mk = (ids: string[], sets: typeof team1) =>
    ids.map((id, i) =>
      mon(id, {
        slot: i,
        isActive: i === 0,
        moveIds: sets[i].moves.map(m => gen.moves.get(m)!.id as string),
      })
    );
  return {
    sides: [side(mk(ids1, team1), p1Overrides), side(mk(ids2, team2), p2Overrides)],
    weather: '',
    terrain: '',
    trickRoom: false,
    turn: 1,
  };
}

const score = (state: BattleState) => evaluate(state, table, 0);

describe('evaluatePokemon (spec §3a)', () => {
  it('KO cliff: 1% HP -> fainted is a ~76-point swing', () => {
    const barely = evaluatePokemon(mon('kingambit', {hp: 1, maxhp: 100}));
    const dead = evaluatePokemon(mon('kingambit', {hp: 0, fainted: true}));
    expect(dead).toBe(0);
    expect(barely).toBeCloseTo(WEIGHTS.ALIVE + 1, 5); // 75 + 100 x 0.01
  });

  it('fainted short-circuits everything', () => {
    const dead = mon('kingambit', {
      hp: 0,
      fainted: true,
      boosts: {atk: 6, def: 6, spa: 6, spd: 6, spe: 6, accuracy: 6, evasion: 6},
      status: 'brn',
      volatiles: ['substitute'],
    });
    expect(evaluatePokemon(dead)).toBe(0);
  });

  it('boost DR curve: +1 Spe = +25, +6 Spe = 82.5, -1 Atk = -15', () => {
    const base = evaluatePokemon(mon('dragonite'));
    const plusOneSpe = evaluatePokemon(mon('dragonite', {boosts: {...mon('x').boosts, spe: 1}}));
    const plusSixSpe = evaluatePokemon(mon('dragonite', {boosts: {...mon('x').boosts, spe: 6}}));
    const minusOneAtk = evaluatePokemon(mon('dragonite', {boosts: {...mon('x').boosts, atk: -1}}));
    expect(plusOneSpe - base).toBeCloseTo(25, 5);
    expect(plusSixSpe - base).toBeCloseTo(3.3 * 25, 5);
    expect(minusOneAtk - base).toBeCloseTo(-15, 5);
  });

  it('status values per spec, burn scaled by physical share', () => {
    const base = evaluatePokemon(mon('x'));
    expect(evaluatePokemon(mon('x', {status: 'frz'})) - base).toBe(-40);
    expect(evaluatePokemon(mon('x', {status: 'tox'})) - base).toBe(-30);
    expect(evaluatePokemon(mon('x', {status: 'slp'})) - base).toBe(-25);
    expect(evaluatePokemon(mon('x', {status: 'par'})) - base).toBe(-25);
    expect(evaluatePokemon(mon('x', {status: 'psn'})) - base).toBe(-10);
    // Burn: pure physical -50, pure special -25.
    expect(evaluatePokemon(mon('x', {status: 'brn'}), 1) - base).toBe(-50);
    expect(evaluatePokemon(mon('x', {status: 'brn'}), 0) - base).toBe(-25);
  });

  it('volatile values per spec', () => {
    const base = evaluatePokemon(mon('x'));
    expect(evaluatePokemon(mon('x', {volatiles: ['substitute']})) - base).toBe(40);
    expect(evaluatePokemon(mon('x', {volatiles: ['leechseed']})) - base).toBe(-30);
    expect(evaluatePokemon(mon('x', {volatiles: ['confusion']})) - base).toBe(-20);
    expect(evaluatePokemon(mon('x', {volatiles: ['substitute', 'leechseed', 'confusion']})) - base).toBe(-10);
  });
});

describe('evaluate (spec §3b + §4)', () => {
  it('is zero-sum on a messy asymmetric state', () => {
    const state = balancedState(
      {
        hazards: {stealthrock: true, spikes: 2, toxicspikes: 1, stickyweb: false},
        screens: {reflect: true, lightscreen: false, auroraveil: false},
        teraUsed: true,
      },
      {tailwind: true, safeguard: true}
    );
    state.sides[0].mons[1] = {...state.sides[0].mons[1], hp: 40, status: 'brn'};
    state.sides[1].mons[2] = {...state.sides[1].mons[2], fainted: true, hp: 0};
    state.sides[0].mons[0] = {
      ...state.sides[0].mons[0],
      boosts: {...state.sides[0].mons[0].boosts, atk: 2, spe: 1},
      volatiles: ['substitute'],
    };
    expect(evaluate(state, table, 0)).toBeCloseTo(-evaluate(state, table, 1), 8);
    expect(evaluate(state, table, 0)).not.toBe(0);
  });

  it('hazards scale with living reserves (x layers)', () => {
    const clean = score(balancedState());
    const sr = balancedState({hazards: {stealthrock: true, spikes: 0, toxicspikes: 0, stickyweb: false}});
    expect(score(sr) - clean).toBeCloseTo(-10 * 5, 5); // 5 living reserves

    // Two reserves fainted -> shallower penalty.
    const srThinned = balancedState({
      hazards: {stealthrock: true, spikes: 0, toxicspikes: 0, stickyweb: false},
    });
    srThinned.sides[0].mons[4] = {...srThinned.sides[0].mons[4], fainted: true, hp: 0};
    srThinned.sides[0].mons[5] = {...srThinned.sides[0].mons[5], fainted: true, hp: 0};
    const thinnedClean = balancedState();
    thinnedClean.sides[0].mons[4] = {...thinnedClean.sides[0].mons[4], fainted: true, hp: 0};
    thinnedClean.sides[0].mons[5] = {...thinnedClean.sides[0].mons[5], fainted: true, hp: 0};
    expect(score(srThinned) - score(thinnedClean)).toBeCloseTo(-10 * 3, 5);

    // Spikes layers multiply.
    const spikes3 = balancedState({hazards: {stealthrock: false, spikes: 3, toxicspikes: 0, stickyweb: false}});
    expect(score(spikes3) - clean).toBeCloseTo(-7 * 3 * 5, 5);
  });

  it('static side conditions score their spec values (matchup term zeroed)', () => {
    // Screens also improve the live matchup term (by design); faint both
    // actives so the delta isolates the static value.
    const noMatchup = (overrides: Partial<SideState>) => {
      const state = balancedState(overrides);
      for (const s of state.sides) s.mons[0] = {...s.mons[0], fainted: true, hp: 0};
      return score(state);
    };
    const clean = noMatchup({});
    expect(noMatchup({screens: {reflect: true, lightscreen: false, auroraveil: false}}) - clean).toBeCloseTo(20, 5);
    expect(noMatchup({screens: {reflect: false, lightscreen: true, auroraveil: false}}) - clean).toBeCloseTo(20, 5);
    expect(noMatchup({screens: {reflect: false, lightscreen: false, auroraveil: true}}) - clean).toBeCloseTo(40, 5);
    expect(noMatchup({safeguard: true}) - clean).toBeCloseTo(5, 5);
    expect(
      noMatchup({hazards: {stealthrock: false, spikes: 0, toxicspikes: 0, stickyweb: true}}) - clean
    ).toBeCloseTo(-25, 5);
  });

  it('screens additionally improve the live matchup term', () => {
    const clean = score(balancedState());
    const reflect = score(balancedState({screens: {reflect: true, lightscreen: false, auroraveil: false}}));
    expect(reflect - clean).toBeGreaterThanOrEqual(20);
  });

  it('tailwind adds its static value plus a speed-race edge', () => {
    const clean = score(balancedState());
    const tw = score(balancedState({tailwind: true}));
    expect(tw - clean).toBeGreaterThanOrEqual(7);
  });

  it('an unused Tera is worth its full option value at a fresh board', () => {
    const clean = score(balancedState());
    const spent = score(balancedState({teraUsed: true}));
    expect(clean - spent).toBeCloseTo(WEIGHTS.TERA_AVAILABLE, 5);
  });

  it('the Tera option value decays as the game progresses (fewer future windows)', () => {
    // Held-Tera value = clean (both hold, nets to 0) minus side-0-spent (nets to
    // -value), isolating one side's option value. Faint mons to advance phase.
    const faint4 = (s: BattleState) => {
      for (const side of [0, 1] as const)
        for (const i of [4, 5]) s.sides[side].mons[i] = {...s.sides[side].mons[i], fainted: true, hp: 0};
      return s;
    };
    const freshHeld = score(balancedState()) - score(balancedState({teraUsed: true}));
    const midHeld = score(faint4(balancedState())) - score(faint4(balancedState({teraUsed: true})));

    expect(freshHeld).toBeCloseTo(WEIGHTS.TERA_AVAILABLE, 5); // 0 faints → full value
    expect(midHeld).toBeCloseTo(WEIGHTS.TERA_AVAILABLE * 0.5, 5); // 4/8 faints → half
    expect(midHeld).toBeLessThan(freshHeld);
  });

  it('matchup: a faster guaranteed-OHKO active scores higher than a slower one', () => {
    // Darkrai Ice Beam OHKOs Gliscor (4x). Fast Darkrai vs slow Darkrai.
    const mkState = (darkraiSpe: number) => {
      const state = balancedState();
      state.sides[0].mons[0] = {...state.sides[0].mons[0], spe: darkraiSpe}; // Darkrai active
      // Put Gliscor active for side 2.
      const gliscorIdx = state.sides[1].mons.findIndex(m => m.speciesId === 'gliscor');
      state.sides[1].mons = state.sides[1].mons.map((m, i) => ({...m, isActive: i === gliscorIdx}));
      state.sides[1].activeIndex = gliscorIdx;
      return state;
    };
    const fast = score(mkState(400));
    const slow = score(mkState(1));
    expect(fast).toBeGreaterThan(slow);
    // And both beat the neutral leads matchup for side 1... sanity: OHKO threat present.
    expect(fast - score(balancedState())).not.toBe(0);
  });

  it('trick room inverts the speed race', () => {
    const mkState = (trickRoom: boolean) => {
      const state = balancedState();
      state.trickRoom = trickRoom;
      state.sides[0].mons[0] = {...state.sides[0].mons[0], spe: 1};
      const gliscorIdx = state.sides[1].mons.findIndex(m => m.speciesId === 'gliscor');
      state.sides[1].mons = state.sides[1].mons.map((m, i) => ({...m, isActive: i === gliscorIdx}));
      state.sides[1].activeIndex = gliscorIdx;
      return state;
    };
    // Slow OHKOer improves under trick room.
    expect(score(mkState(true))).toBeGreaterThan(score(mkState(false)));
  });
});
