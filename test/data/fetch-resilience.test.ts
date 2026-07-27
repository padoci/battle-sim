import {describe, expect, it} from 'vitest';
import {MemoryStore, type CacheEntry, type KVStore} from '../../src/data/cache';
import {cachedJson} from '../../src/data/fetch';

/**
 * Failure-injection around the cache store and the response body.
 *
 * The load-bearing property: **a working network must never be reported as a
 * broken one.** The app's only error copy for a failed load says "check your
 * connection and reload", so anything that routes a non-network failure into
 * that path actively lies to the user — and on Safari private browsing or a
 * quota-full device, IndexedDB failing is routine, not exotic.
 */

function fakeFetch(handler: (url: string) => unknown): {fetch: typeof fetch; calls: string[]} {
  const calls: string[] = [];
  const impl = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const result = handler(url);
    if (result instanceof Error) throw result;
    if (typeof result === 'number') return new Response('', {status: result});
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {'content-type': 'application/json'},
    });
  };
  return {fetch: impl as typeof fetch, calls};
}

const URLS = ['https://primary/x.json', 'https://mirror/x.json'];

/** An IndexedDB that opened fine and then fails on transactions. */
class ThrowingStore implements KVStore {
  constructor(private readonly mode: 'get' | 'set' | 'both') {}
  async get(): Promise<CacheEntry | undefined> {
    if (this.mode === 'get' || this.mode === 'both') throw new Error('IDB read failed');
    return undefined;
  }
  async set(): Promise<void> {
    if (this.mode === 'set' || this.mode === 'both') throw new Error('QuotaExceededError');
    return undefined;
  }
}

describe('cachedJson with a broken cache store', () => {
  it('still returns the payload when the cache WRITE fails (quota / private mode)', async () => {
    const {fetch, calls} = fakeFetch(() => ({v: 1}));
    const result = await cachedJson('x', URLS, {store: new ThrowingStore('set'), fetchFn: fetch});
    expect(result.data).toEqual({v: 1});
    expect(result.fromCache).toBe(false);
    expect(calls).toEqual(['https://primary/x.json']);
  });

  it('still returns the payload when the cache READ fails', async () => {
    const {fetch} = fakeFetch(() => ({v: 1}));
    const result = await cachedJson('x', URLS, {store: new ThrowingStore('get'), fetchFn: fetch});
    expect(result.data).toEqual({v: 1});
  });

  it('still returns the payload when the cache is broken in both directions', async () => {
    const {fetch} = fakeFetch(() => ({v: 1}));
    await expect(
      cachedJson('x', URLS, {store: new ThrowingStore('both'), fetchFn: fetch})
    ).resolves.toMatchObject({data: {v: 1}});
  });

  it('only reports "all sources failed" when the network really did fail', async () => {
    const {fetch} = fakeFetch(() => new Error('offline'));
    await expect(
      cachedJson('x', URLS, {store: new ThrowingStore('both'), fetchFn: fetch})
    ).rejects.toThrow(/all sources failed/);
  });
});

describe('cachedJson shape validation', () => {
  const validate = (data: unknown) =>
    typeof data === 'object' && data !== null && 'pokemon' in data;

  it('fails a wrong-shaped 200 over to the mirror', async () => {
    const store = new MemoryStore();
    const {fetch, calls} = fakeFetch(url =>
      url.includes('primary') ? {error: 'try again later'} : {pokemon: {Dragapult: {}}}
    );
    const result = await cachedJson('x', URLS, {store, fetchFn: fetch, validate});
    expect(result.data).toEqual({pokemon: {Dragapult: {}}});
    expect(calls).toEqual(['https://primary/x.json', 'https://mirror/x.json']);
  });

  it('never caches a wrong-shaped body', async () => {
    const store = new MemoryStore();
    const {fetch} = fakeFetch(() => ({error: 'nope'}));
    await expect(cachedJson('x', URLS, {store, fetchFn: fetch, validate})).rejects.toThrow(
      /all sources failed/
    );
    // The critical half: nothing was written, so a reload retries rather than
    // serving the garbage for a full 24h TTL.
    expect(await store.get('x')).toBeUndefined();
  });

  it('rejects when every source is wrong-shaped, rather than returning garbage', async () => {
    const {fetch, calls} = fakeFetch(() => ({}));
    await expect(
      cachedJson('x', URLS, {store: new MemoryStore(), fetchFn: fetch, validate})
    ).rejects.toThrow(/wrong shape|all sources failed/);
    expect(calls).toHaveLength(2);
  });

  it('accepts a well-shaped body unchanged', async () => {
    const {fetch} = fakeFetch(() => ({pokemon: {Gliscor: {}}}));
    const result = await cachedJson('x', URLS, {store: new MemoryStore(), fetchFn: fetch, validate});
    expect(result.data).toEqual({pokemon: {Gliscor: {}}});
  });
});
