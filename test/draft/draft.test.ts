import {describe, expect, it} from 'vitest';
import {
  createDraft,
  OFFERS_PER_ROUND,
  pickBundle,
  pickSet,
  pickSpecies,
  TEAM_SIZE,
  type DraftState,
} from '../../src/draft/draft';

import type {PoolEntry, SetsData} from '../../src/data/types';
import setsFull from '../fixtures/gen9ou.sets.full.json';
import statsFixture from '../fixtures/stats.fixture.json';

const sets = setsFull as SetsData;

/** Real pool: every species in the full sets file, usage where known. */
const stats = statsFixture as unknown as {pokemon: Record<string, {usage: {weighted: number}}>};
const pool: PoolEntry[] = Object.entries(sets).map(([species, byName]) => ({
  species,
  setNames: Object.keys(byName),
  usageWeighted: stats.pokemon[species]?.usage.weighted ?? 0,
}));

function draftWholeTeamHard(seed: number): DraftState {
  let state = createDraft(pool, sets, 'hard', seed);
  while (state.phase !== 'complete') {
    state = pickBundle(state, pool, sets, 0);
  }
  return state;
}

describe('createDraft / offers', () => {
  it('deals the right offer counts per mode', () => {
    expect(createDraft(pool, sets, 'easy', 1).offers).toHaveLength(OFFERS_PER_ROUND.easy);
    expect(createDraft(pool, sets, 'normal', 1).offers).toHaveLength(OFFERS_PER_ROUND.normal);
    expect(createDraft(pool, sets, 'hard', 1).offers).toHaveLength(OFFERS_PER_ROUND.hard);
  });

  it('same seed + same picks -> identical offers (determinism, no reroll)', () => {
    const a = draftWholeTeamHard(1234);
    const b = draftWholeTeamHard(1234);
    expect(a.team).toEqual(b.team);

    const c = createDraft(pool, sets, 'hard', 1234);
    expect(c.offers).toEqual(createDraft(pool, sets, 'hard', 1234).offers);
  });

  it('hard bundles are complete concrete sets with visible slashes', () => {
    const state = createDraft(pool, sets, 'hard', 5);
    for (const offer of state.offers) {
      expect(offer.setName).toBeTruthy();
      expect(offer.set!.species).toBe(offer.species);
      expect(offer.set!.moves.length).toBeGreaterThan(0);
      expect(offer.set!.ability).toBeTruthy();
      expect(offer.slashes).toBeDefined();
    }
  });
});

describe('Species Clause', () => {
  it('drafted species never reappear; final team has 6 distinct species', () => {
    let state = createDraft(pool, sets, 'hard', 77);
    const seen: string[] = [];
    while (state.phase !== 'complete') {
      for (const offer of state.offers) {
        expect(seen).not.toContain(offer.species);
      }
      seen.push(state.offers[0].species);
      state = pickBundle(state, pool, sets, 0);
    }
    expect(state.team).toHaveLength(TEAM_SIZE);
    expect(new Set(state.team.map(p => p.species)).size).toBe(TEAM_SIZE);
  });
});

describe('two-stage flow (easy/normal)', () => {
  it('species pick reveals that species\' named sets; set pick fills the tray', () => {
    let state = createDraft(pool, sets, 'easy', 9);
    const species = state.offers[3].species;
    state = pickSpecies(state, sets, species);
    expect(state.phase).toBe('set');
    expect(state.setOptions!.length).toBeGreaterThan(0);
    expect(state.setOptions!.map(o => o.setName)).toEqual(Object.keys(sets[species]));

    const chosen = state.setOptions![0];
    state = pickSet(state, pool, sets, chosen.setName);
    expect(state.team).toEqual([{species, setName: chosen.setName, set: chosen.set}]);
    expect(state.phase).toBe('species');
    expect(state.round).toBe(2);
    expect(state.offers).toHaveLength(OFFERS_PER_ROUND.easy);
  });

  it('normal shares the two-stage flow (species pick reveals sets)', () => {
    let state = createDraft(pool, sets, 'normal', 9);
    expect(state.offers).toHaveLength(OFFERS_PER_ROUND.normal);
    const species = state.offers[0].species;
    state = pickSpecies(state, sets, species);
    expect(state.phase).toBe('set');
    expect(state.setOptions!.length).toBeGreaterThan(0);
  });

  it('the picked set IS the displayed set (display == battle by construction)', () => {
    let state = createDraft(pool, sets, 'easy', 11);
    const species = state.offers[0].species;
    state = pickSpecies(state, sets, species);
    const option = state.setOptions![0];
    const picked = pickSet(state, pool, sets, option.setName);
    expect(picked.team[0].set).toBe(option.set);
  });

  it('set options are committed builds: deterministic, pure, alternatives from the wire set', () => {
    const base = createDraft(pool, sets, 'easy', 11);
    const species = base.offers[0].species;

    // Same state -> deeply identical options (pure), and rngState untouched.
    const a = pickSpecies(base, sets, species);
    const b = pickSpecies(base, sets, species);
    expect(a.setOptions).toEqual(b.setOptions);
    expect(a.rngState).toBe(base.rngState);

    // Every resolved move is a member of its wire slot's alternatives.
    for (const option of a.setOptions!) {
      const wire = sets[species][option.setName];
      option.set.moves.forEach(move => {
        const inSomeSlot = wire.moves.some(slot =>
          Array.isArray(slot) ? slot.includes(move) : slot === move
        );
        expect(inSomeSlot).toBe(true);
      });
    }

    // Species offers after a pick are unchanged vs the unforked stream: the
    // resolution rng is forked, so later rounds deal identical species.
    const picked = pickSet(a, pool, sets, a.setOptions![0].setName);
    const pickedAgain = pickSet(pickSpecies(base, sets, species), pool, sets, a.setOptions![0].setName);
    expect(picked.offers.map(o => o.species)).toEqual(pickedAgain.offers.map(o => o.species));
  });

  it("different seeds eventually resolve a slashed set differently (proves 'sample' is live)", () => {
    // Kingambit "Swords Dance" carries slashed moves + 4 tera types in the fixture.
    const resolutions = new Set<string>();
    for (let seed = 0; seed < 40 && resolutions.size < 2; seed++) {
      let state: DraftState = {
        mode: 'easy',
        rngState: seed >>> 0,
        round: 1,
        phase: 'species',
        offers: [{species: 'Kingambit', usageWeighted: 1}],
        team: [],
      };
      state = pickSpecies(state, sets, 'Kingambit');
      const sd = state.setOptions!.find(o => o.setName === 'Swords Dance');
      if (sd) resolutions.add(JSON.stringify([sd.set.moves, sd.set.teraType]));
    }
    expect(resolutions.size).toBeGreaterThan(1);
  });
});

describe('usage weighting', () => {
  it('high-usage mons appear in round-1 offers far more often than floor mons, but floor mons do appear', () => {
    // Kingambit has ~24% usage; pick a zero-usage pool species as the floor mon.
    const floorMon = pool.find(p => p.usageWeighted === 0)!.species;
    let kingambitCount = 0;
    let floorCount = 0;
    for (let seed = 0; seed < 400; seed++) {
      const offers = createDraft(pool, sets, 'normal', seed).offers.map(o => o.species);
      if (offers.includes('Kingambit')) kingambitCount++;
      if (offers.includes(floorMon)) floorCount++;
    }
    expect(kingambitCount).toBeGreaterThan(floorCount * 3);
    expect(floorCount).toBeGreaterThan(0);
  });
});
