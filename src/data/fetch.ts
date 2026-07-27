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
  /**
   * Cheap top-level shape check on a parsed body. A 200 carrying JSON of the
   * WRONG shape (a mirror mid-rewrite, a captive portal, an error envelope)
   * otherwise counts as success: the mirror is never tried and the garbage is
   * cached for a full TTL. Rejecting here throws inside the per-URL try, so
   * failover happens for free. Keep it to a top-level assertion — do not walk
   * a 3MB payload on every load.
   */
  validate?: (data: unknown) => boolean;
}

/** Store I/O is best-effort: a cache that fails must never fail the load. */
async function safeGet(store: KVStore, key: string) {
  try {
    return await store.get(key);
  } catch {
    // Private-mode IndexedDB, a blocked transaction, a corrupt DB: fall
    // through to the network rather than bricking on a good connection.
    return undefined;
  }
}

async function safeSet(store: KVStore, key: string, entry: {fetchedAt: number; payload: unknown}) {
  try {
    await store.set(key, entry);
  } catch {
    // Quota exceeded (stats is ~3MB), Safari ITP eviction, private mode. The
    // data is already in hand and about to be returned — caching it is an
    // optimisation, and failing the whole load over it told the user to
    // "check your connection" when the network had worked perfectly.
  }
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
async function fetchJsonStreamed<T>(
  url: string,
  fetchFn: typeof fetch,
  stallMs: number,
  validate?: (data: unknown) => boolean
): Promise<T> {
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
    if (!response.body) return checkShape<T>(await response.json(), url, validate);

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
    return checkShape<T>(JSON.parse(new TextDecoder().decode(buf)), url, validate);
  } finally {
    clearTimeout(stallTimer);
  }
}

function checkShape<T>(data: unknown, url: string, validate?: (data: unknown) => boolean): T {
  if (validate && !validate(data)) {
    throw new Error(`GET ${url} -> 200 but the payload has the wrong shape`);
  }
  return data as T;
}

/**
 * Try each URL in order; a URL that errors, stalls, OR returns a wrong-shaped
 * body fails over to the next. Sequential, not concurrent — racing a mirror in
 * parallel with a live-but-slow primary would only split the already-scarce
 * bandwidth on the connection that's actually the bottleneck, making both slower.
 */
async function fetchFirstSuccess<T>(
  urls: string[],
  fetchFn: typeof fetch,
  stallMs: number,
  validate?: (data: unknown) => boolean
): Promise<T> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      return await fetchJsonStreamed<T>(url, fetchFn, stallMs, validate);
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
    validate,
  } = options;

  const cached = await safeGet(store, key);
  if (cached && now() - cached.fetchedAt < ttlMs) {
    return {data: cached.payload as T, fetchedAt: cached.fetchedAt, fromCache: true};
  }

  if (cached) {
    const revalidated = fetchFirstSuccess<T>(urls, fetchFn, timeoutMs, validate)
      .then(async data => {
        await safeSet(store, key, {fetchedAt: now(), payload: data});
      })
      .catch(() => {
        // Refresh failure is invisible by design: the stale copy already served.
      });
    return {data: cached.payload as T, fetchedAt: cached.fetchedAt, fromCache: true, revalidated};
  }

  let data: T;
  try {
    data = await fetchFirstSuccess<T>(urls, fetchFn, timeoutMs, validate);
  } catch (error) {
    throw new Error(`all sources failed for ${key}: ${String(error)}`);
  }
  // Deliberately outside the try above: the network has already succeeded, so
  // a cache write failure must not be reported as "all sources failed".
  const fetchedAt = now();
  await safeSet(store, key, {fetchedAt, payload: data});
  return {data, fetchedAt, fromCache: false};
}
