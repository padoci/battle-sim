import type {KVStore} from './cache';

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * STALL timeout, not a wall-clock timeout: a URL is only aborted if no new
 * bytes arrive for this long, never merely for taking a long time overall.
 * This was a real bug, not a hypothetical one — the previous wall-clock
 * timeout aborted the ~3MB stats payload on any connection too slow to
 * finish it within 8s even while bytes were still actively arriving,
 * surfacing as "Dealing your first hand…" failing outright around 25-30s
 * on a throttled connection (reproduced with Chrome DevTools network
 * emulation: 750kbps/300ms latency -> AbortError at ~27s). A connection
 * that's merely slow but working now finishes however long it takes; only a
 * genuinely dead/hung one gets cut off and failed over to the next URL.
 */
export const DEFAULT_STALL_TIMEOUT_MS = 8000;

export interface CachedJsonOptions {
  store: KVStore;
  /** Cache freshness window; entries older than this trigger a background
   * revalidation (the stale entry is still served immediately). */
  ttlMs?: number;
  /** Injectable clock (epoch ms) for tests. */
  now?: () => number;
  /** Injectable fetch for tests. */
  fetchFn?: typeof fetch;
  /** Per-URL stall timeout — see DEFAULT_STALL_TIMEOUT_MS. */
  timeoutMs?: number;
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
 * Fetch and parse one URL as JSON, aborting only on a STALL (no forward
 * progress for `stallMs`) rather than total elapsed time. Streams the body
 * so genuine progress — including slow, chunk-by-chunk progress — keeps
 * pushing the deadline out indefinitely.
 */
async function fetchJsonStreamed<T>(url: string, fetchFn: typeof fetch, stallMs: number): Promise<T> {
  const controller = new AbortController();
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const armStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(), stallMs);
  };

  try {
    armStall(); // covers a connection that never even opens
    const response = await fetchFn(url, {signal: controller.signal});
    armStall(); // headers arrived; body must now show progress within stallMs
    if (!response.ok) throw new Error(`GET ${url} -> HTTP ${response.status}`);

    // response.body is unavailable in a few edge environments (defensive
    // fallback only — no per-chunk progress to reset the stall on, so this
    // path keeps the old one-shot behavior rather than risking a hang).
    if (!response.body) return (await response.json()) as T;

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      armStall(); // real progress: push the deadline back out
      chunks.push(value);
      total += value.length;
    }
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      buf.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(buf)) as T;
  } finally {
    clearTimeout(stallTimer);
  }
}

/**
 * Try each URL in order; a URL that errors OR stalls fails over to the
 * next. Sequential, not concurrent — racing a mirror in parallel with a
 * live-but-slow primary would only split the already-scarce bandwidth on
 * the connection that's actually the bottleneck, making both slower.
 */
async function fetchFirstSuccess<T>(urls: string[], fetchFn: typeof fetch, stallMs: number): Promise<T> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await fetchJsonStreamed<T>(url, fetchFn, stallMs);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Fetch JSON through the cache:
 * - fresh cache entry (< ttl old) -> served without touching the network;
 * - stale entry -> served IMMEDIATELY, refreshed in the background
 *   (stale-while-revalidate: a returning user never waits, even past the
 *   TTL, and never bricks when offline);
 * - no entry -> try each URL in turn (stall-timeout failover), first
 *   success cached.
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
    timeoutMs = DEFAULT_STALL_TIMEOUT_MS,
  } = options;

  const cached = await store.get(key);
  if (cached && now() - cached.fetchedAt < ttlMs) {
    return {data: cached.payload as T, fetchedAt: cached.fetchedAt, fromCache: true};
  }

  if (cached) {
    const revalidated = fetchFirstSuccess<T>(urls, fetchFn, timeoutMs)
      .then(async data => {
        await store.set(key, {fetchedAt: now(), payload: data});
      })
      .catch(() => {
        // Refresh failure is invisible by design: the stale copy already served.
      });
    return {data: cached.payload as T, fetchedAt: cached.fetchedAt, fromCache: true, revalidated};
  }

  try {
    const data = await fetchFirstSuccess<T>(urls, fetchFn, timeoutMs);
    const fetchedAt = now();
    await store.set(key, {fetchedAt, payload: data});
    return {data, fetchedAt, fromCache: false};
  } catch (error) {
    throw new Error(`all sources failed for ${key}: ${String(error)}`);
  }
}
