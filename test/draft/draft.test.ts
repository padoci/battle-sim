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
import {resolveMoveset} from '../../src/data/resolve';
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

function draftWholeTeamNormal(seed: number): DraftState {
  let state = createDraft(pool, sets, 'normal', seed);
  while (state.phase !== 'complete') {
    state = pickBundle(state, pool, sets, 0);
  }
  return state;
}

describe('createDraft / offers', () => {
  it('deals the right offer counts per mode', () => {
    expect(createDraft(pool, sets, 'beginner', 1).offers).toHaveLength(OFFERS_PER_ROUND.beginner);
    expect(createDraft(pool, sets, 'normal', 1).offers).toHaveLength(OFFERS_PER_ROUND.normal);
  });

  it('same seed + same picks -> identical offers (determinism, no reroll)', () => {
    const a = draftWholeTeamNormal(1234);
    const b = draftWholeTeamNormal(1234);
    expect(a.team).toEqual(b.team);

    const c = createDraft(pool, sets, 'normal', 1234);
    expect(c.offers).toEqual(createDraft(pool, sets, 'normal', 1234).offers);
  });

  it('normal bundles are complete concrete sets with visible slashes', () => {
    const state = createDraft(pool, sets, 'normal', 5);
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
    let state = createDraft(pool, sets, 'normal', 77);
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

describe('beginner two-stage flow', () => {
  it('species pick reveals that species\' named sets; set pick fills the tray', () => {
    let state = createDraft(pool, sets, 'beginner', 9);
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
    expect(state.offers).toHaveLength(OFFERS_PER_ROUND.beginner);
  });

  it("the picked set IS the displayed 'first'-resolved set", () => {
    let state = createDraft(pool, sets, 'beginner', 11);
    const species = state.offers[0].species;
    state = pickSpecies(state, sets, species);
    const option = state.setOptions![0];
    expect(option.set).toEqual(resolveMoveset(species, sets[species][option.setName]));
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
