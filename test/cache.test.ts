import {describe, expect, it} from 'vitest';
import {MemoryStore} from '../src/data/cache';
import {cachedJson, DEFAULT_TTL_MS} from '../src/data/fetch';

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

describe('cachedJson', () => {
  it('fetches on miss, then serves fresh hits without the network', async () => {
    const store = new MemoryStore();
    let time = 1_000;
    const {fetch, calls} = fakeFetch(() => ({v: 1}));

    const first = await cachedJson('x', URLS, {store, now: () => time, fetchFn: fetch});
    expect(first).toEqual({data: {v: 1}, fetchedAt: 1_000, fromCache: false});

    time += DEFAULT_TTL_MS - 1;
    const second = await cachedJson('x', URLS, {store, now: () => time, fetchFn: fetch});
    expect(second.fromCache).toBe(true);
    expect(second.fetchedAt).toBe(1_000);
    expect(calls).toEqual(['https://primary/x.json']);
  });

  it('refetches once the TTL expires', async () => {
    const store = new MemoryStore();
    let time = 0;
    let version = 1;
    const {fetch, calls} = fakeFetch(() => ({v: version}));

    await cachedJson('x', URLS, {store, now: () => time, fetchFn: fetch});
    time = DEFAULT_TTL_MS;
    version = 2;
    const result = await cachedJson('x', URLS, {store, now: () => time, fetchFn: fetch});
    expect(result).toEqual({data: {v: 2}, fetchedAt: DEFAULT_TTL_MS, fromCache: false});
    expect(calls).toHaveLength(2);
  });

  it('falls back to the mirror when the primary fails', async () => {
    const store = new MemoryStore();
    const {fetch, calls} = fakeFetch(url =>
      url.startsWith('https://primary') ? 403 : {from: 'mirror'}
    );

    const result = await cachedJson('x', URLS, {store, now: () => 0, fetchFn: fetch});
    expect(result.data).toEqual({from: 'mirror'});
    expect(calls).toEqual(URLS);
  });

  it('fails over to the mirror when the primary stalls, within the timeout', async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://primary')) {
        // Never resolves on its own; only settles if aborted - simulates a
        // primary that hangs rather than erroring or responding slowly.
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      return new Response(JSON.stringify({from: 'mirror'}), {
        status: 200,
        headers: {'content-type': 'application/json'},
      });
    }) as typeof fetch;

    const result = await cachedJson('x', URLS, {store, now: () => 0, fetchFn: impl, timeoutMs: 20});
    expect(result.data).toEqual({from: 'mirror'});
    expect(calls).toEqual(URLS);
  });

  it('serves a stale entry when every source fails', async () => {
    const store = new MemoryStore();
    let time = 0;
    let down = false;
    const {fetch} = fakeFetch(() => (down ? new Error('offline') : {v: 1}));

    await cachedJson('x', URLS, {store, now: () => time, fetchFn: fetch});
    time = DEFAULT_TTL_MS * 10;
    down = true;
    const result = await cachedJson('x', URLS, {store, now: () => time, fetchFn: fetch});
    expect(result).toEqual({data: {v: 1}, fetchedAt: 0, fromCache: true});
  });

  it('throws when every source fails and nothing is cached', async () => {
    const store = new MemoryStore();
    const {fetch} = fakeFetch(() => new Error('offline'));
    await expect(cachedJson('x', URLS, {store, now: () => 0, fetchFn: fetch})).rejects.toThrow(
      /all sources failed/
    );
  });

  it('round-trips through IndexedDB', async () => {
    const {indexedDB} = await import('fake-indexeddb');
    const {IndexedDBStore} = await import('../src/data/cache');
    const store = await IndexedDBStore.open(indexedDB);

    await store.set('k', {fetchedAt: 5, payload: {hello: 'world'}});
    expect(await store.get('k')).toEqual({fetchedAt: 5, payload: {hello: 'world'}});
    expect(await store.get('missing')).toBeUndefined();
  });
});
