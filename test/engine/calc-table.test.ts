import {describe, expect, it} from 'vitest';
import {calculate, Field as CalcField, Move as CalcMove, Pokemon as CalcPokemon} from '@smogon/calc';
import {gen9} from '../../src/data/gen';
import {buildCalcTable, ensureFresh, getEntry} from '../../src/engine/calc/table';
import {damageScalar, koProb, modifiedFrac} from '../../src/engine/calc/modifiers';
import type {BattleState, MonState, SideState} from '../../src/engine/snapshot';
import {fixtureTeams} from './helpers';

const gen = gen9();
const [team1, team2] = fixtureTeams();
const table = buildCalcTable(gen, [team1, team2]);

const darkrai = team1[0]; // Dark Pulse / Focus Blast / Ice Beam / Sludge Bomb
const gliscor = team2[2]; // Tera Fairy

function mon(overrides: Partial<MonState>): MonState {
  return {
    slot: 0,
    speciesId: 'darkrai',
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

function side(overrides: Partial<SideState> = {}): SideState {
  return {
    mons: [],
    activeIndex: 0,
    hazards: {stealthrock: false, spikes: 0, toxicspikes: 0, stickyweb: false},
    screens: {reflect: false, lightscreen: false, auroraveil: false},
    tailwind: false,
    safeguard: false,
    teraUsed: false,
    ...overrides,
  };
}

interface SetLike {
  species: string;
  [key: string]: unknown;
}

function directRolls(atk: SetLike, def: SetLike, move: string): number[] {
  const {species: atkSpecies, ...atkOpts} = atk;
  const {species: defSpecies, ...defOpts} = def;
  const result = calculate(
    gen as never,
    new CalcPokemon(gen as never, atkSpecies, atkOpts as never),
    new CalcPokemon(gen as never, defSpecies, defOpts as never),
    new CalcMove(gen as never, move)
  );
  return Array.isArray(result.damage) ? (result.damage as number[]) : [result.damage as number];
}

const setOpts = (set: typeof darkrai) => ({
  species: set.species,
  level: set.level,
  item: set.item || undefined,
  ability: set.ability,
  nature: set.nature,
  evs: set.evs,
  ivs: set.ivs,
});

const darkraiState = () => mon({speciesId: 'darkrai', moveIds: ['darkpulse', 'focusblast', 'icebeam', 'sludgebomb']});
const gliscorState = () =>
  mon({speciesId: 'gliscor', itemId: 'toxicorb', abilityId: 'poisonheal', hp: 353, maxhp: 353});

describe('buildCalcTable', () => {
  it('base rolls match direct @smogon/calc calls', () => {
    // Spot-check several attacker/move/defender combos, no Tera.
    const cases: Array<[0 | 1, typeof darkrai, number, typeof darkrai]> = [
      [0, darkrai, 2, gliscor], // Ice Beam -> Gliscor (4x weak)
      [0, darkrai, 0, team2[4]], // Dark Pulse -> Slowking-Galar
      [1, gliscor, 0, team1[3]], // Earthquake -> Kingambit
      [1, team2[1], 0, team1[0]], // Dragapult move 1 -> Darkrai
    ];
    for (const [atkSide, atkSet, moveIndex, defSet] of cases) {
      const entry = getEntry(
        table,
        atkSide,
        mon({speciesId: gen.species.get(atkSet.species)!.id}),
        moveIndex,
        mon({speciesId: gen.species.get(defSet.species)!.id})
      )!;
      const expected = directRolls(setOpts(atkSet), setOpts(defSet), atkSet.moves[moveIndex]);
      expect(entry.rolls, `${atkSet.species} ${atkSet.moves[moveIndex]} vs ${defSet.species}`).toEqual(
        expected.filter(d => d > 0)
      );
    }
  });

  it('defender Tera slice flips effectiveness (Ice Beam vs Tera Fairy Gliscor)', () => {
    const base = getEntry(table, 0, darkraiState(), 2, gliscorState())!;
    const teraDef = getEntry(table, 0, darkraiState(), 2, {...gliscorState(), terastallized: true})!;

    // 4x super-effective normally; neutral-ish under Tera Fairy.
    expect(base.expected).toBeGreaterThan(teraDef.expected * 3);
    expect(teraDef.rolls).toEqual(
      directRolls(setOpts(darkrai), {...setOpts(gliscor), teraType: 'Fairy'} as never, 'Ice Beam')
    );
  });

  it('attacker Tera slice boosts STAB (Tera Poison Darkrai Sludge Bomb)', () => {
    const base = getEntry(table, 0, darkraiState(), 3, gliscorState())!;
    const teraAtk = getEntry(table, 0, {...darkraiState(), terastallized: true}, 3, gliscorState())!;
    expect(teraAtk.expected).toBeGreaterThan(base.expected * 1.2); // gains STAB
    expect(teraAtk.rolls).toEqual(
      directRolls({...setOpts(darkrai), teraType: 'Poison'} as never, setOpts(gliscor), 'Sludge Bomb')
    );
  });

  it('status moves produce empty rolls and zero fractions', () => {
    // Gliscor's Protect (index 2) and Swords Dance (index 3).
    for (const moveIndex of [2, 3]) {
      const entry = getEntry(table, 1, mon({speciesId: 'gliscor'}), moveIndex, mon({speciesId: 'darkrai'}))!;
      expect(entry.category).toBe('Status');
      expect(entry.rolls).toEqual([]);
      expect(entry.expectedFrac).toBe(0);
    }
  });

  it('expectedFrac is the mean roll over defender max HP', () => {
    const entry = getEntry(table, 0, darkraiState(), 0, mon({speciesId: 'tinglu'}))!;
    const tingLuMaxHp = new CalcPokemon(gen as never, 'Ting-Lu', setOpts(team2[0]) as never).maxHP();
    const mean = entry.rolls.reduce((a, b) => a + b, 0) / entry.rolls.length;
    expect(entry.expected).toBeCloseTo(mean, 10);
    expect(entry.expectedFrac).toBeCloseTo(mean / tingLuMaxHp, 10);
  });

  it('rejects duplicate species (Species Clause assumption)', () => {
    expect(() => buildCalcTable(gen, [[darkrai, {...darkrai}], team2])).toThrow(/duplicate species/);
  });
});

describe('scalar modifiers', () => {
  const field = {weather: ''};

  it('reads within tolerance of direct calc under +2 Atk, burn, and Reflect', () => {
    // Gliscor Earthquake -> Zamazenta with the works.
    const zamazenta = team1[5];
    const entry = getEntry(table, 1, mon({speciesId: 'gliscor'}), 0, mon({speciesId: 'zamazenta'}))!;
    const atk = mon({speciesId: 'gliscor', status: 'brn', boosts: {...mon({}).boosts, atk: 2}});
    const zamaCalc = new CalcPokemon(gen as never, 'Zamazenta', setOpts(zamazenta) as never);
    const def = mon({speciesId: 'zamazenta', hp: zamaCalc.maxHP(), maxhp: zamaCalc.maxHP()});
    const defSide = side({screens: {reflect: true, lightscreen: false, auroraveil: false}});

    const scaled = entry.expected * damageScalar(entry, atk, def, defSide, field);

    const truth = calculate(
      gen as never,
      new CalcPokemon(gen as never, 'Gliscor', {
        ...setOpts(gliscor),
        boosts: {atk: 2},
        status: 'brn',
      } as never),
      zamaCalc,
      new CalcMove(gen as never, 'Earthquake'),
      new CalcField({defenderSide: {isReflect: true}})
    );
    const truthRolls = truth.damage as number[];
    const truthMean = truthRolls.reduce((a, b) => a + b, 0) / truthRolls.length;

    expect(Math.abs(scaled - truthMean) / truthMean).toBeLessThan(0.15);
  });

  it('base entries encode item immunities (EQ vs Air Balloon Kingambit = 0)', () => {
    const entry = getEntry(table, 1, mon({speciesId: 'gliscor'}), 0, mon({speciesId: 'kingambit'}))!;
    expect(entry.rolls).toEqual([]);
    expect(entry.expected).toBe(0);
  });

  it('koProb counts scaled rolls against current hp', () => {
    const entry = getEntry(table, 0, darkraiState(), 2, gliscorState())!; // Ice Beam 4x
    const glisc = gliscorState();

    expect(koProb(entry, darkraiState(), glisc, side(), field)).toBe(1); // 461-547 vs 353
    const bulky = {...glisc, hp: 10_000, maxhp: 10_000};
    expect(koProb(entry, darkraiState(), bulky, side(), field)).toBe(0);
    // Partial: hp inside the roll range.
    const mid = {...glisc, hp: Math.round((entry.rolls[0] + entry.rolls[15]) / 2)};
    const partial = koProb(entry, darkraiState(), mid, side(), field);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
  });

  it('modifiedFrac halves physical damage under burn and Reflect independently', () => {
    const entry = getEntry(table, 1, mon({speciesId: 'gliscor'}), 0, mon({speciesId: 'kingambit'}))!;
    const atk = mon({speciesId: 'gliscor'});
    const def = mon({speciesId: 'kingambit', hp: 100, maxhp: 100});
    const base = modifiedFrac(entry, atk, def, side(), field);
    const burned = modifiedFrac(entry, {...atk, status: 'brn'}, def, side(), field);
    const screened = modifiedFrac(
      entry,
      atk,
      def,
      side({screens: {reflect: true, lightscreen: false, auroraveil: false}}),
      field
    );
    expect(burned).toBeCloseTo(base / 2, 10);
    expect(screened).toBeCloseTo(base / 2, 10);
  });
});

describe('ensureFresh (§4d invalidation)', () => {
  function stateWith(mons0: MonState[], mons1: MonState[]): BattleState {
    return {
      sides: [side({mons: mons0}), side({mons: mons1})],
      weather: '',
      terrain: '',
      trickRoom: false,
      turn: 5,
    };
  }

  function teamStates(): [MonState[], MonState[]] {
    const toState = (sets: typeof team1) =>
      sets.map((set, i) =>
        mon({
          slot: i,
          speciesId: gen.species.get(set.species)!.id,
          itemId: set.item ? gen.items.get(set.item)!.id : '',
          abilityId: gen.abilities.get(set.ability)!.id,
          moveIds: set.moves.map(m => gen.moves.get(m)!.id),
          isActive: i === 0,
        })
      );
    return [toState(team1), toState(team2)];
  }

  it('is a no-op when identities match', () => {
    const fresh = buildCalcTable(gen, [team1, team2]);
    const [mons0, mons1] = teamStates();
    expect(ensureFresh(fresh, stateWith(mons0, mons1))).toBe(0);
  });

  it('rebuilds after an item is knocked off, matching direct calc', () => {
    const fresh = buildCalcTable(gen, [team1, team2]);
    const [mons0, mons1] = teamStates();
    const kingambitIdx = mons1.findIndex(m => m.speciesId === 'kingambit');
    mons1[kingambitIdx] = {...mons1[kingambitIdx], itemId: ''}; // Air Balloon... actually item gone

    expect(ensureFresh(fresh, stateWith(mons0, mons1))).toBe(1);
    expect(ensureFresh(fresh, stateWith(mons0, mons1))).toBe(0); // idempotent

    // Kingambit's own rows now computed itemless.
    const kingambitSet = team2.find(s => s.species === 'Kingambit')!;
    const entry = getEntry(fresh, 1, mon({speciesId: 'kingambit'}), 0, mon({speciesId: 'darkrai'}))!;
    expect(entry.rolls).toEqual(
      directRolls({...setOpts(kingambitSet), item: undefined}, setOpts(darkrai), kingambitSet.moves[0])
    );
  });
});
