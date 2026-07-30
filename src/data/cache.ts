/** A cached payload plus when it was fetched (epoch ms). */
export interface CacheEntry<T = unknown> {
  fetchedAt: number;
  payload: T;
}

/** Minimal async key-value store the fetch layer caches through. */
export interface KVStore {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
}

/** In-memory store: tests, SSR, and the fallback when IndexedDB is unusable. */
export class MemoryStore implements KVStore {
  private readonly map = new Map<string, CacheEntry>();

  async get(key: string): Promise<CacheEntry | undefined> {
    return this.map.get(key);
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    this.map.set(key, entry);
  }
}

/**
 * Renamed with the app. No migration on purpose: every entry carries a
 * `fetchedAt` and expires after DEFAULT_TTL_MS (24h), so the whole database is
 * disposable by construction — the worst a returning visitor pays is one extra
 * cold fetch they would have paid within the day anyway. Copying ~3 MB between
 * two IndexedDB databases to save that is more code, and more to go wrong, than
 * the thing it buys. The old `battle-sim-data` database is simply abandoned.
 */
const DB_NAME = 'teampreview-data';
const DB_VERSION = 1;
const STORE_NAME = 'http-cache';

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * IndexedDB-backed store (key = logical resource key). Preferred in the
 * browser: the stats payload (~3 MB) does not fit localStorage quotas.
 */
export class IndexedDBStore implements KVStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(idb: IDBFactory = indexedDB): Promise<IndexedDBStore> {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    return new IndexedDBStore(await requestToPromise(req));
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const tx = this.db.transaction(STORE_NAME, 'readonly');
    const value = await requestToPromise(tx.objectStore(STORE_NAME).get(key));
    return value as CacheEntry | undefined;
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const tx = this.db.transaction(STORE_NAME, 'readwrite');
    await requestToPromise(tx.objectStore(STORE_NAME).put(entry, key));
  }
}

/**
 * Best store available in this environment: IndexedDB when it opens,
 * otherwise memory (private browsing, tests, non-browser runtimes).
 */
export async function openStore(): Promise<KVStore> {
  if (typeof indexedDB !== 'undefined') {
    try {
      return await IndexedDBStore.open();
    } catch {
      // fall through to memory
    }
  }
  return new MemoryStore();
}
