import type {KVStore} from './cache';

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Hard per-URL network timeout: a stalled (not merely erroring) source must
 * still fail in bounded time rather than hang the whole load — see the
 * AbortController pattern this mirrors in sampleTeams.ts. */
export const DEFAULT_FETCH_TIMEOUT_MS = 8000;

/** Head start the primary gets before the mirror joins the race. Long enough
 * that a healthy primary answers alone (one request, one host), short enough
 * that a crawling primary only costs this much before the mirror's CDN can
 * win the cold load. A failed attempt starts the next URL immediately. */
export const DEFAULT_MIRROR_STAGGER_MS = 1500;

export interface CachedJsonOptions {
  store: KVStore;
  /** Cache freshness window; entries older than this trigger a background
   * revalidation (the stale entry is still served immediately). */
  ttlMs?: number;
  /** Injectable clock (epoch ms) for tests. */
  now?: () => number;
  /** Injectable fetch for tests. */
  fetchFn?: typeof fetch;
  /** Per-URL network timeout. */
  timeoutMs?: number;
  /** Delay before each further URL joins the race (tests set it to 0). */
  mirrorStaggerMs?: number;
}

export interface CachedJsonResult<T> {
  data: T;
  fetchedAt: number;
  fromCache: boolean;
  /** Present when a stale entry was served: resolves once the background
   * refresh settles (success or not). Callers may ignore it; tests await it. */
  revalidated?: Promise<void>;
}

/**
 * Race the source URLs with a staggered start: URL 0 fires immediately, each
 * later URL joins after `staggerMs` (or the moment an earlier attempt fails).
 * First success wins and aborts the rest; rejects only when every URL failed.
 */
function raceUrls<T>(
  urls: string[],
  fetchFn: typeof fetch,
  timeoutMs: number,
  staggerMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let nextIndex = 0;
    let inFlight = 0;
    let done = false;
    const errors: unknown[] = [];
    const controllers: AbortController[] = [];
    const timers: Array<ReturnType<typeof setTimeout>> = [];

    const cleanup = () => {
      for (const timer of timers) clearTimeout(timer);
      for (const controller of controllers) controller.abort();
    };

    const launchNext = () => {
      if (done || nextIndex >= urls.length) return;
      const url = urls[nextIndex++];
      inFlight++;

      const controller = new AbortController();
      controllers.push(controller);
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      timers.push(timeout);

      // Give the NEXT url its stagger timer now, so a slow (not failed)
      // attempt doesn't block the race from widening.
      if (nextIndex < urls.length) {
        const stagger = setTimeout(launchNext, staggerMs);
        timers.push(stagger);
      }

      (async () => {
        const response = await fetchFn(url, {signal: controller.signal});
        if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`);
        return (await response.json()) as T;
      })().then(
        data => {
          if (done) return;
          done = true;
          cleanup();
          resolve(data);
        },
        error => {
          clearTimeout(timeout);
          errors.push(error);
          inFlight--;
          if (done) return;
          launchNext(); // a failure shouldn't wait out the stagger
          if (inFlight === 0 && nextIndex >= urls.length) {
            done = true;
            cleanup();
            reject(errors[errors.length - 1]);
          }
        }
      );
    };

    launchNext();
  });
}

/**
 * Fetch JSON through the cache:
 * - fresh cache entry (< ttl old) -> served without touching the network;
 * - stale entry -> served IMMEDIATELY, refreshed in the background
 *   (stale-while-revalidate: a returning user never waits, even past the
 *   TTL, and never bricks when offline);
 * - no entry -> staggered race across the URLs, first success cached.
 */
export async function cachedJson<T>(
  key: string,
  urls: string[],
  options: CachedJsonOptions
): Promise<CachedJsonResult<T>> {
  const {
    store,
    ttlMs = DEFAULT_TTL_MS,
    now = Date.now,
    fetchFn = fetch,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
    mirrorStaggerMs = DEFAULT_MIRROR_STAGGER_MS,
  } = options;

  const cached = await store.get(key);
  if (cached && now() - cached.fetchedAt < ttlMs) {
    return {data: cached.payload as T, fetchedAt: cached.fetchedAt, fromCache: true};
  }

  if (cached) {
    const revalidated = raceUrls<T>(urls, fetchFn, timeoutMs, mirrorStaggerMs)
      .then(async data => {
        await store.set(key, {fetchedAt: now(), payload: data});
      })
      .catch(() => {
        // Refresh failure is invisible by design: the stale copy already served.
      });
    return {data: cached.payload as T, fetchedAt: cached.fetchedAt, fromCache: true, revalidated};
  }

  try {
    const data = await raceUrls<T>(urls, fetchFn, timeoutMs, mirrorStaggerMs);
    const fetchedAt = now();
    await store.set(key, {fetchedAt, payload: data});
    return {data, fetchedAt, fromCache: false};
  } catch (error) {
    throw new Error(`all sources failed for ${key}: ${String(error)}`);
  }
}
