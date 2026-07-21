import {describe, expect, it} from 'vitest';
import {createDraft, OFFERS_PER_ROUND, pickBundle, TEAM_SIZE, type DraftMode} from '../../src/draft/draft';

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

const MODES: DraftMode[] = ['gymleader', 'easy', 'hard'];

function draftWholeTeam(mode: DraftMode, seed: number) {
  let state = createDraft(pool, sets, mode, seed);
  while (state.phase !== 'complete') {
    state = pickBundle(state, pool, sets, 0);
  }
  return state;
}

describe('createDraft / offers', () => {
  it('every mode deals 6 bundle offers', () => {
    for (const mode of MODES) {
      expect(createDraft(pool, sets, mode, 1).offers).toHaveLength(OFFERS_PER_ROUND);
    }
  });

  it('same seed + same picks -> identical offers (determinism, no reroll)', () => {
    const a = draftWholeTeam('hard', 1234);
    const b = draftWholeTeam('hard', 1234);
    expect(a.team).toEqual(b.team);

    const c = createDraft(pool, sets, 'hard', 1234);
    expect(c.offers).toEqual(createDraft(pool, sets, 'hard', 1234).offers);
  });

  it('bundles are complete, concrete pre-made sets (species+set together, no slashes to resolve)', () => {
    for (const mode of MODES) {
      const state = createDraft(pool, sets, mode, 5);
      for (const offer of state.offers) {
        expect(offer.setName).toBeTruthy();
        expect(offer.set.species).toBe(offer.species);
        expect(offer.set.moves.length).toBeGreaterThan(0);
        expect(offer.set.ability).toBeTruthy();
        expect(offer.slashes).toBeDefined();
      }
    }
  });

  it('a bundle set resolution is seed-independent (deterministic "first" strategy)', () => {
    // Same species+setName combo always resolves to the identical concrete
    // set regardless of which seed dealt it — no per-run variation.
    const bySpeciesSet = new Map<string, unknown>();
    for (let seed = 0; seed < 30; seed++) {
      for (const offer of createDraft(pool, sets, 'gymleader', seed).offers) {
        const key = `${offer.species}::${offer.setName}`;
        if (bySpeciesSet.has(key)) {
          expect(offer.set).toEqual(bySpeciesSet.get(key));
        } else {
          bySpeciesSet.set(key, offer.set);
        }
      }
    }
    expect(bySpeciesSet.size).toBeGreaterThan(0);
  });
});

describe('Species Clause', () => {
  it('drafted species never reappear; final team has 6 distinct species', () => {
    for (const mode of MODES) {
      let state = createDraft(pool, sets, mode, 77);
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
    }
  });
});

describe('usage weighting', () => {
  it('high-usage mons appear in round-1 offers far more often than floor mons, but floor mons do appear', () => {
    // Kingambit has ~24% usage; pick a zero-usage pool species as the floor mon.
    const floorMon = pool.find(p => p.usageWeighted === 0)!.species;
    let kingambitCount = 0;
    let floorCount = 0;
    for (let seed = 0; seed < 400; seed++) {
      const offers = createDraft(pool, sets, 'easy', seed).offers.map(o => o.species);
      if (offers.includes('Kingambit')) kingambitCount++;
      if (offers.includes(floorMon)) floorCount++;
    }
    expect(kingambitCount).toBeGreaterThan(floorCount * 3);
    expect(floorCount).toBeGreaterThan(0);
  });
});
