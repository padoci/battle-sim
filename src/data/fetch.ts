import type {KVStore} from './cache';

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedJsonOptions {
  store: KVStore;
  /** Cache freshness window; entries older than this are refetched. */
  ttlMs?: number;
  /** Injectable clock (epoch ms) for tests. */
  now?: () => number;
  /** Injectable fetch for tests. */
  fetchFn?: typeof fetch;
}

export interface CachedJsonResult<T> {
  data: T;
  fetchedAt: number;
  fromCache: boolean;
}

/**
 * Fetch JSON through the cache:
 * - fresh cache entry (< ttl old) -> served without touching the network;
 * - otherwise try each URL in order and cache the first success;
 * - if every URL fails but a stale entry exists, serve it (never brick a
 *   returning user just because they're offline).
 */
export async function cachedJson<T>(
  key: string,
  urls: string[],
  options: CachedJsonOptions
): Promise<CachedJsonResult<T>> {
  const {store, ttlMs = DEFAULT_TTL_MS, now = Date.now, fetchFn = fetch} = options;

  const cached = await store.get(key);
  if (cached && now() - cached.fetchedAt < ttlMs) {
    return {data: cached.payload as T, fetchedAt: cached.fetchedAt, fromCache: true};
  }

  let lastError: unknown;
  for (const url of urls) {
    try {
      const response = await fetchFn(url);
      if (!response.ok) {
        lastError = new Error(`GET ${url} -> HTTP ${response.status}`);
        continue;
      }
      const data = (await response.json()) as T;
      const fetchedAt = now();
      await store.set(key, {fetchedAt, payload: data});
      return {data, fetchedAt, fromCache: false};
    } catch (error) {
      lastError = error;
    }
  }

  if (cached) {
    return {data: cached.payload as T, fetchedAt: cached.fetchedAt, fromCache: true};
  }
  throw new Error(`all sources failed for ${key}: ${String(lastError)}`);
}
