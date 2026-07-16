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

const DB_NAME = 'battle-sim-data';
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
