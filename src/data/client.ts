import {MemoryStore, openStore, type KVStore} from './cache';
import {resourceKey, resourceUrls, type FormatId, type Resource} from './endpoints';
import {cachedJson, type CachedJsonResult} from './fetch';
import type {Moveset, PoolEntry, SetsData, StatsData, Team} from './types';

export interface DataClientOptions {
  store?: KVStore;
  ttlMs?: number;
  now?: () => number;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export interface ResourceMeta {
  fetchedAt: number;
  fromCache: boolean;
}

/**
 * Typed access to the three data.pkmn.cc resources for one format, memoized
 * per client instance and cached across sessions through the injected store.
 */
export class DataClient {
  private readonly store: Promise<KVStore>;
  private readonly memo = new Map<Resource, Promise<CachedJsonResult<unknown>>>();

  constructor(
    readonly format: FormatId,
    private readonly options: DataClientOptions = {}
  ) {
    this.store = options.store ? Promise.resolve(options.store) : openStore();
  }

  /** For tests and non-browser use: a client with a throwaway memory store. */
  static inMemory(format: FormatId, options: Omit<DataClientOptions, 'store'> = {}): DataClient {
    return new DataClient(format, {...options, store: new MemoryStore()});
  }

  private load<T>(resource: Resource): Promise<CachedJsonResult<T>> {
    let pending = this.memo.get(resource);
    if (!pending) {
      pending = this.store.then(store =>
        cachedJson<unknown>(resourceKey(resource, this.format), resourceUrls(resource, this.format), {
          store,
          ttlMs: this.options.ttlMs,
          now: this.options.now,
          fetchFn: this.options.fetchFn,
          timeoutMs: this.options.timeoutMs,
        })
      );
      this.memo.set(resource, pending);
      // Allow a later retry rather than memoizing the failure forever.
      pending.catch(() => this.memo.delete(resource));
    }
    return pending as Promise<CachedJsonResult<T>>;
  }

  async sets(): Promise<SetsData> {
    return (await this.load<SetsData>('sets')).data;
  }

  async stats(): Promise<StatsData> {
    return (await this.load<StatsData>('stats')).data;
  }

  async teams(): Promise<Team[]> {
    return (await this.load<Team[]>('teams')).data;
  }

  /** Fetch metadata (age, cache hit) for a resource that has been loaded. */
  async meta(resource: Resource): Promise<ResourceMeta> {
    const {fetchedAt, fromCache} = await this.load(resource);
    return {fetchedAt, fromCache};
  }

  /**
   * The draft pool: every species with a set in this format, joined with its
   * weighted usage (0 when the species is missing from the stats report),
   * sorted by usage descending.
   */
  async pool(): Promise<PoolEntry[]> {
    const [sets, stats] = await Promise.all([this.sets(), this.stats()]);
    return Object.entries(sets)
      .map(([species, byName]) => ({
        species,
        setNames: Object.keys(byName),
        usageWeighted: stats.pokemon[species]?.usage.weighted ?? 0,
      }))
      .sort((a, b) => b.usageWeighted - a.usageWeighted || a.species.localeCompare(b.species));
  }

  /** Named (still-slashed) sets for one pool species, or undefined. */
  async setsFor(species: string): Promise<Record<string, Moveset> | undefined> {
    return (await this.sets())[species];
  }
}
