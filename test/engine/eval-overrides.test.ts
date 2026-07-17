import {afterEach, describe, expect, it} from 'vitest';
import {gen9} from '../../src/data/gen';
import {buildCalcTable} from '../../src/engine/calc/table';
import {evaluate, setEvalOverrides, WEIGHTS} from '../../src/engine/eval';
import type {BattleState, MonState, SideState} from '../../src/engine/snapshot';
import {fixtureTeams} from './helpers';

const gen = gen9();
const [team1, team2] = fixtureTeams();
const table = buildCalcTable(gen, [team1, team2]);

function mon(speciesId: string, slot: number): MonState {
  return {
    slot, speciesId, hp: 100, maxhp: 100, fainted: false,
    boosts: {atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0},
    status: '', volatiles: [], itemId: '', abilityId: '', teraType: '',
    terastallized: false, spe: 100, moveIds: [], isActive: slot === 0,
  };
}

function side(speciesIds: string[], teraUsed: boolean): SideState {
  return {
    mons: speciesIds.map((id, i) => mon(id, i)),
    activeIndex: 0,
    hazards: {stealthrock: false, spikes: 0, toxicspikes: 0, stickyweb: false},
    screens: {reflect: false, lightscreen: false, auroraveil: false},
    tailwind: false, safeguard: false, teraUsed,
  };
}

/** P1 has Tera available, P2 has spent it — the term the override moves. */
function state(): BattleState {
  return {
    sides: [side(['darkrai', 'kingambit'], false), side(['tinglu', 'gliscor'], true)],
    weather: '', terrain: '', trickRoom: false, turn: 1,
  };
}

afterEach(() => setEvalOverrides(undefined));

describe('setEvalOverrides (the ?tera dev knob)', () => {
  it('changes the evaluation by exactly the delta on the asymmetric term', () => {
    const stock = evaluate(state(), table, 0);
    setEvalOverrides({teraAvailable: WEIGHTS.TERA_AVAILABLE + 15});
    expect(evaluate(state(), table, 0)).toBeCloseTo(stock + 15, 8);
  });

  it('preserves zero-sum under any override', () => {
    setEvalOverrides({teraAvailable: 37});
    const s = state();
    expect(evaluate(s, table, 0)).toBeCloseTo(-evaluate(s, table, 1), 8);
  });

  it('clearing restores stock behavior exactly', () => {
    const stock = evaluate(state(), table, 0);
    setEvalOverrides({teraAvailable: 99});
    expect(evaluate(state(), table, 0)).not.toBeCloseTo(stock, 8);
    setEvalOverrides(undefined);
    expect(evaluate(state(), table, 0)).toBe(stock);
  });
});
