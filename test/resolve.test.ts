import {describe, expect, it} from 'vitest';
import {resolveMoveset, slashInfo} from '../src/data/resolve';
import type {Moveset, SetsData} from '../src/data/types';
import setsFixture from './fixtures/sets.fixture.json';

const sets = setsFixture as SetsData;
const kingambit = sets['Kingambit']['Swords Dance'];
const ddDragonite = sets['Dragonite']['Dragon Dance'];
const scaleShot = sets['Dragonite']['Dragon Dance + Scale Shot'];
const cmClefable = sets['Clefable']['Calm Mind'];
const ditto = sets['Ditto']['Choice Scarf'];

/** Deterministic uniform-ish rng from a seed. */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("resolveMoveset 'first'", () => {
  it('takes the first alternative of every slash (upstream toSet semantics)', () => {
    const set = resolveMoveset('Kingambit', kingambit);
    expect(set).toEqual({
      name: 'Kingambit',
      species: 'Kingambit',
      item: 'Leftovers',
      ability: 'Supreme Overlord',
      moves: ['Swords Dance', 'Sucker Punch', 'Kowtow Cleave', 'Iron Head'],
      nature: 'Adamant',
      gender: '',
      evs: {hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252},
      ivs: {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31},
      level: 100,
      teraType: 'Ghost',
    });
  });

  it('handles bare-string teratypes and single-value fields', () => {
    const set = resolveMoveset('Dragonite', scaleShot);
    expect(set.teraType).toBe('Fire');
    expect(set.item).toBe('Loaded Dice');
    expect(set.nature).toBe('Jolly');
  });

  it('applies partial ivs over a 31 default', () => {
    const set = resolveMoveset('Clefable', cmClefable);
    expect(set.ivs).toEqual({hp: 31, atk: 0, def: 31, spa: 31, spd: 31, spe: 31});
  });

  it('handles movesets with fewer than 4 slots (Ditto)', () => {
    const set = resolveMoveset('Ditto', ditto);
    expect(set.moves).toEqual(['Transform']);
    expect(set.level).toBe(100);
  });

  it("fills the species' default ability when the set omits it (Chansey)", () => {
    const set = resolveMoveset('Chansey', sets['Chansey']['Defensive']);
    expect(set.ability).toBe('Natural Cure');
  });
});

describe("resolveMoveset 'sample'", () => {
  const opts = (seed: number) => ({strategy: 'sample' as const, rng: seededRng(seed)});

  it('is deterministic for a given seed', () => {
    const a = resolveMoveset('Kingambit', kingambit, opts(42));
    const b = resolveMoveset('Kingambit', kingambit, opts(42));
    expect(a).toEqual(b);
  });

  it('never emits duplicate moves despite cross-slot collisions', () => {
    // Kingambit lists Low Kick in two slots; every seed must still yield 4 unique moves.
    for (let seed = 0; seed < 200; seed++) {
      const set = resolveMoveset('Kingambit', kingambit, opts(seed));
      expect(new Set(set.moves).size).toBe(kingambit.moves.length);
    }
  });

  it('only ever picks listed alternatives', () => {
    for (let seed = 0; seed < 50; seed++) {
      const set = resolveMoveset('Kingambit', kingambit, opts(seed));
      expect(kingambit.item).toContain(set.item);
      expect(kingambit.teratypes).toContain(set.teraType);
      for (const [i, slot] of kingambit.moves.entries()) {
        const options = Array.isArray(slot) ? slot : [slot];
        expect(options.some(o => set.moves.includes(o))).toBe(true);
        void i;
      }
    }
  });

  it('index-pairs nature and evs when their lengths match', () => {
    // Synthetic paired set: 2 natures x 2 spreads.
    const paired: Moveset = {
      moves: ['Tackle'],
      ability: 'Sturdy',
      nature: ['Adamant', 'Bold'],
      evs: [
        {atk: 252, spe: 252},
        {hp: 252, def: 252},
      ],
    };
    for (let seed = 0; seed < 100; seed++) {
      const set = resolveMoveset('X', paired, opts(seed));
      if (set.nature === 'Adamant') {
        expect(set.evs.atk).toBe(252);
      } else {
        expect(set.evs.hp).toBe(252);
      }
    }
  });

  it('treats unequal-length nature/evs lists as independent', () => {
    // Dragonite DD: 2 natures x 1 spread — spread constant across natures.
    const seen = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const set = resolveMoveset('Dragonite', ddDragonite, opts(seed));
      seen.add(set.nature);
      expect(set.evs).toEqual({hp: 0, atk: 252, def: 4, spa: 0, spd: 0, spe: 252});
    }
    expect(seen).toEqual(new Set(['Adamant', 'Jolly']));
  });
});

describe('slashInfo', () => {
  it('reports every slashed field of Kingambit Swords Dance', () => {
    const info = slashInfo(kingambit);
    expect(info.moveSlots).toEqual([
      {slot: 2, options: ['Kowtow Cleave', 'Low Kick']},
      {slot: 3, options: ['Iron Head', 'Low Kick']},
    ]);
    expect(info.item).toEqual(['Leftovers', 'Lum Berry', 'Black Glasses', 'Air Balloon']);
    expect(info.teratypes).toEqual(['Ghost', 'Dark', 'Fighting', 'Fire']);
    expect(info.evSpreads).toBe(2);
    expect(info.ability).toBeUndefined();
    expect(info.nature).toBeUndefined();
  });

  it('reports only the teratypes slash for Chansey Defensive', () => {
    expect(slashInfo(sets['Chansey']['Defensive'])).toEqual({
      moveSlots: [],
      teratypes: ['Ghost', 'Steel', 'Fairy'],
    });
  });
});
