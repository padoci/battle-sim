import type {KVStore} from './cache';

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Hard per-URL network timeout: a stalled (not merely erroring) primary must
 * still fail over to the next URL in bounded time rather than hang the whole
 * load — see the AbortController pattern this mirrors in sampleTeams.ts. */
export const DEFAULT_FETCH_TIMEOUT_MS = 8000;

export interface CachedJsonOptions {
  store: KVStore;
  /** Cache freshness window; entries older than this are refetched. */
  ttlMs?: number;
  /** Injectable clock (epoch ms) for tests. */
  now?: () => number;
  /** Injectable fetch for tests. */
  fetchFn?: typeof fetch;
  /** Per-URL network timeout before failing over to the next URL. */
  timeoutMs?: number;
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
  const {
    store,
    ttlMs = DEFAULT_TTL_MS,
    now = Date.now,
    fetchFn = fetch,
    timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  } = options;

  const cached = await store.get(key);
  if (cached && now() - cached.fetchedAt < ttlMs) {
    return {data: cached.payload as T, fetchedAt: cached.fetchedAt, fromCache: true};
  }

  let lastError: unknown;
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(url, {signal: controller.signal});
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
    } finally {
      clearTimeout(timer);
    }
  }

  if (cached) {
    return {data: cached.payload as T, fetchedAt: cached.fetchedAt, fromCache: true};
  }
  throw new Error(`all sources failed for ${key}: ${String(lastError)}`);
}
