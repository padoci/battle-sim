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

  it('serves stale immediately once the TTL expires, revalidating in the background', async () => {
    const store = new MemoryStore();
    let time = 0;
    let version = 1;
    const {fetch, calls} = fakeFetch(() => ({v: version}));

    await cachedJson('x', URLS, {store, now: () => time, fetchFn: fetch});
    time = DEFAULT_TTL_MS;
    version = 2;
    // Stale-while-revalidate: the expired entry is served without waiting...
    const stale = await cachedJson('x', URLS, {store, now: () => time, fetchFn: fetch});
    expect(stale.data).toEqual({v: 1});
    expect(stale.fromCache).toBe(true);
    // ...and once the background refresh lands, the next call is fresh.
    await stale.revalidated;
    expect(calls).toHaveLength(2);
    const next = await cachedJson('x', URLS, {store, now: () => time, fetchFn: fetch});
    expect(next).toEqual({data: {v: 2}, fetchedAt: DEFAULT_TTL_MS, fromCache: true});
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

  it('fails over to the mirror when the primary genuinely stalls (zero bytes, ever)', async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://primary')) {
        // Never resolves on its own; only settles if aborted - simulates a
        // dead/hung primary (a TCP connection that never sends anything).
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

  it('REGRESSION: a slow-but-continuously-progressing primary succeeds via itself, never fails over', async () => {
    // This is the bug the user actually hit in production: a large payload
    // over a throttled-but-working connection was being killed by a
    // wall-clock timeout even while bytes kept arriving, then failing
    // outright once the mirror ALSO couldn't finish in the same window.
    // Reproduced live with Chrome DevTools network emulation (750kbps/300ms
    // latency -> AbortError around 27s) before this fix.
    const store = new MemoryStore();
    const calls: string[] = [];
    const encoder = new TextEncoder();
    const payload = JSON.stringify({v: 1, big: 'x'.repeat(1000)});
    const bytes = encoder.encode(payload);
    const impl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      // Trickle the body out in small chunks, each arriving just under the
      // stall timeout apart — never stalling, but taking far longer in
      // TOTAL than the stall timeout. A wall-clock timeout would kill this;
      // a stall timeout must not.
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const chunkSize = 16;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            await new Promise(r => setTimeout(r, 6)); // « the 20ms stall timeout below
            controller.enqueue(bytes.slice(i, i + chunkSize));
          }
          controller.close();
        },
      });
      return new Response(stream, {status: 200, headers: {'content-type': 'application/json'}});
    }) as typeof fetch;

    const result = await cachedJson('x', URLS, {store, now: () => 0, fetchFn: impl, timeoutMs: 20});
    expect(result.data).toEqual({v: 1, big: 'x'.repeat(1000)});
    // Only the primary was ever called — it succeeded on its own merits,
    // slowly, without the mirror ever being needed.
    expect(calls).toEqual(['https://primary/x.json']);
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
    expect(result).toMatchObject({data: {v: 1}, fetchedAt: 0, fromCache: true});
    await result.revalidated; // background refresh fails silently
    const again = await cachedJson('x', URLS, {store, now: () => time, fetchFn: fetch});
    expect(again.data).toEqual({v: 1});
  });

  it('a healthy primary answers alone; the mirror never fires', async () => {
    const store = new MemoryStore();
    const {fetch, calls} = fakeFetch(() => ({v: 1}));
    await cachedJson('x', URLS, {store, now: () => 0, fetchFn: fetch});
    expect(calls).toEqual(['https://primary/x.json']);
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
