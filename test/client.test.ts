import {describe, expect, it} from 'vitest';
import {DataClient} from '../src/data/client';
import type {SetsData, StatsData, Team} from '../src/data/types';
import setsFixture from './fixtures/sets.fixture.json';
import statsFixture from './fixtures/stats.fixture.json';
import teamsFixture from './fixtures/teams.fixture.json';

const sets = setsFixture as SetsData;
const stats = statsFixture as unknown as StatsData;
const teams = teamsFixture as Team[];

function fixtureFetch(): {fetch: typeof fetch; calls: string[]} {
  const calls: string[] = [];
  const impl = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const body = url.includes('/sets/') ? sets : url.includes('/stats/') ? stats : teams;
    return new Response(JSON.stringify(body), {status: 200});
  };
  return {fetch: impl as typeof fetch, calls};
}

describe('DataClient', () => {
  it('joins sets and stats into a usage-sorted pool', async () => {
    const {fetch} = fixtureFetch();
    const client = DataClient.inMemory('gen9ou', {fetchFn: fetch});

    const pool = await client.pool();
    expect(pool.map(p => p.species)).toEqual([
      'Kingambit',
      'Dragonite',
      'Clefable',
      'Ditto',
      'Chansey',
    ]);
    expect(pool[0].usageWeighted).toBeGreaterThan(0.2);
    expect(pool[0].setNames).toEqual(['Swords Dance']);
    // Chansey is in the sets file but not the stats fixture -> weight 0, sorted last.
    expect(pool[4]).toMatchObject({species: 'Chansey', usageWeighted: 0});
  });

  it('fetches each resource once and memoizes', async () => {
    const {fetch, calls} = fixtureFetch();
    const client = DataClient.inMemory('gen9ou', {fetchFn: fetch});

    await Promise.all([client.pool(), client.pool(), client.teams(), client.setsFor('Ditto')]);
    await client.stats();
    expect(calls).toHaveLength(3); // sets, stats, teams — once each
  });

  it('exposes teams, including entries with no name/author', async () => {
    const {fetch} = fixtureFetch();
    const client = DataClient.inMemory('gen9ou', {fetchFn: fetch});

    const loaded = await client.teams();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].data).toHaveLength(6);
    expect(loaded[1].name ?? null).toBeNull();
    expect(loaded[1].author ?? null).toBeNull();
  });

  it('returns undefined sets for a species outside the pool', async () => {
    const {fetch} = fixtureFetch();
    const client = DataClient.inMemory('gen9ou', {fetchFn: fetch});
    expect(await client.setsFor('Missingno')).toBeUndefined();
  });
});
