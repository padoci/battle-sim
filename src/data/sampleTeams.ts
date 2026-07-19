import {Teams, TeamValidator} from '@pkmn/sim';
import type {KVStore} from './cache';
import type {DataClient} from './client';
import {setToTeamMember, teamMemberToSet} from './team';
import type {PokemonSet, Team} from './types';
import minedTeamsJson from './mined-teams.gen9ou.json';
import vendoredTeamsJson from './vendored-teams.gen9ou.json';

/** Real sample teams shipped as a static asset (see scripts/build-sample-teams.ts). */
const vendoredTeams = vendoredTeamsJson as unknown as Team[];
/** Real high-ladder team *compositions* paired with a standard build per
 *  species, mined from public replays (see scripts/mine-ladder-teams.ts). */
const minedTeams = minedTeamsJson as unknown as Team[];

/**
 * Augment the built-in opponent pool with real, externally-sourced teams
 * fetched at runtime in the browser: the Smogon Sample Teams, aggregated by
 * crob.at and resolved through pokepaste's JSON API. Import + validate as
 * gen9ou, convert to the same `Team` shape as `/teams/gen9ou.json`, and merge.
 *
 * Best-effort by design: the app must work with the built-in pool alone, so
 * every failure path (unreachable source, blocked CORS, malformed payload,
 * illegal teams) resolves to `[]` rather than throwing. The sandbox can't
 * reach these hosts — there it always falls back; the real value is realized
 * in a user's browser.
 */

const SAMPLES_INDEX = 'https://crob.at/api/samples/gen9ou';
const CACHE_KEY = 'samples/gen9ou.json';
const TTL_MS = 24 * 60 * 60 * 1000;
/** A failed/empty attempt is negative-cached this long so a dead/blocked source
 *  doesn't re-fetch on every navigation (but recovers within the hour). */
const NEGATIVE_TTL_MS = 60 * 60 * 1000;
/** Cap the fan-out: bounded fetches, aggressively cached. Well above the
 *  source's current size (~21) so it can grow without another code change. */
const MAX_TEAMS = 40;
const CONCURRENCY = 6;
/** Hard cap on the whole network fetch — it can never hang. */
const FETCH_TIMEOUT_MS = 8000;

export interface SampleTeamsOptions {
  store: KVStore;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Override the index URL (tests). */
  indexUrl?: string;
  /** Hard network timeout for the whole fetch (tests). */
  timeoutMs?: number;
}

interface SampleRef {
  /** A pokepaste URL to resolve via its `/json` endpoint. */
  url?: string;
  /** An inline Showdown export, when the index carries the team directly. */
  paste?: string;
  title?: string | null;
  author?: string | null;
}

interface ResolvedExport {
  text: string;
  title?: string | null;
  author?: string | null;
}

const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const isPasteUrl = (v: string): boolean => /^https?:\/\//i.test(v);
/** A Showdown export has at least a move line; a bare URL/name does not. */
const looksLikeExport = (v: string): boolean => v.includes('\n') && /(^|\n)- /.test(v);

/** Normalize the index payload (array, or an object wrapping one) to a list. */
function toArray(index: unknown): unknown[] {
  if (Array.isArray(index)) return index;
  if (index && typeof index === 'object') {
    for (const key of ['teams', 'samples', 'data', 'results']) {
      const v = (index as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

function toRef(item: unknown): SampleRef | undefined {
  if (typeof item === 'string') {
    if (isPasteUrl(item)) return {url: item};
    return looksLikeExport(item) ? {paste: item} : undefined;
  }
  if (!item || typeof item !== 'object') return undefined;
  const o = item as Record<string, unknown>;
  const title = strOrNull(o.title ?? o.name);
  const author = strOrNull(o.author ?? o.by ?? o.creator);
  // Inline export text wins — no round-trip needed.
  for (const key of ['paste', 'export', 'sets', 'data', 'team']) {
    const v = o[key];
    if (typeof v === 'string' && looksLikeExport(v)) return {paste: v, title, author};
  }
  // Otherwise resolve a pokepaste URL.
  for (const key of ['url', 'link', 'href', 'pokepaste', 'paste']) {
    const v = o[key];
    if (typeof v === 'string' && isPasteUrl(v)) return {url: v, title, author};
  }
  return undefined;
}

/**
 * crob.at is its own team-storage site, not a pokepaste-compatible host — its
 * team pages don't answer a `/json` suffix (that 404s or, worse, 200s with the
 * HTML page itself). Its real API is documented at https://crob.at/api:
 * `GET /api/team/:slug` returns `{..., teams: [{paste}]}`. Everything else
 * (pokepast.es and compatible hosts) keeps the plain `/json` → `{paste}` shape.
 */
function apiRequestFor(url: string): {apiUrl: string; extractPaste: (body: unknown) => string | undefined} {
  const trimmed = url.replace(/\/+$/, '');
  const crobAt = /^https?:\/\/crob\.at\/([^/]+)$/i.exec(trimmed);
  if (crobAt) {
    return {
      apiUrl: `https://crob.at/api/team/${crobAt[1]}`,
      extractPaste: body => (body as {teams?: Array<{paste?: string}>} | undefined)?.teams?.[0]?.paste,
    };
  }
  return {
    apiUrl: `${trimmed}/json`,
    extractPaste: body => (body as {paste?: string} | undefined)?.paste,
  };
}

async function resolveExport(
  ref: SampleRef,
  fetchFn: typeof fetch,
  signal?: AbortSignal
): Promise<ResolvedExport | undefined> {
  if (ref.paste) return {text: ref.paste, title: ref.title, author: ref.author};
  if (!ref.url) return undefined;
  const {apiUrl, extractPaste} = apiRequestFor(ref.url);
  try {
    const res = await fetchFn(apiUrl, {signal});
    if (!res.ok) return undefined;
    const body = (await res.json()) as {title?: string; name?: string; author?: string};
    const paste = extractPaste(body);
    if (!paste) return undefined;
    return {
      text: paste,
      title: ref.title ?? strOrNull(body.title ?? body.name),
      author: ref.author ?? strOrNull(body.author),
    };
  } catch {
    return undefined;
  }
}

/** Import + validate one export into a `Team`, or drop it (illegal/malformed). */
function toTeam(exported: ResolvedExport, validator: TeamValidator): Team | undefined {
  let sets: PokemonSet[] | null;
  try {
    sets = Teams.import(exported.text) as unknown as PokemonSet[] | null;
  } catch {
    return undefined;
  }
  if (!sets || sets.length !== 6) return undefined;
  let problems: string[] | null;
  try {
    problems = validator.validateTeam(sets as never);
  } catch {
    return undefined;
  }
  if (problems && problems.length > 0) return undefined;
  return {
    name: exported.title ?? null,
    author: exported.author ?? null,
    data: sets.map(setToTeamMember),
  };
}

/** Map with a bounded number of concurrent workers (preserves order). */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
  return out;
}

/**
 * Fresh cached sample teams, or undefined if none/stale. A non-empty result is
 * good for 24h; an empty (failed) result is negative-cached for 1h.
 */
async function readCached(store: KVStore, now: () => number): Promise<Team[] | undefined> {
  try {
    const cached = await store.get(CACHE_KEY);
    if (!cached) return undefined;
    const payload = cached.payload as Team[];
    const ttl = payload.length > 0 ? TTL_MS : NEGATIVE_TTL_MS;
    return now() - cached.fetchedAt < ttl ? payload : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchSampleTeams(opts: SampleTeamsOptions): Promise<Team[]> {
  const {store, fetchFn = fetch, now = Date.now, indexUrl = SAMPLES_INDEX, timeoutMs = FETCH_TIMEOUT_MS} = opts;

  const cached = await readCached(store, now);
  if (cached) return cached;

  // Hard timeout: aborting guarantees the fetch can never hang indefinitely.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let teams: Team[] = [];
  try {
    const res = await fetchFn(indexUrl, {signal: controller.signal});
    if (res.ok) {
      const refs = toArray(await res.json())
        .map(toRef)
        .filter((r): r is SampleRef => !!r)
        .slice(0, MAX_TEAMS);
      const validator = new TeamValidator('gen9ou');
      const exports = await mapPool(refs, CONCURRENCY, ref => resolveExport(ref, fetchFn, controller.signal));
      teams = exports
        .filter((e): e is ResolvedExport => !!e)
        .map(e => toTeam(e, validator))
        .filter((t): t is Team => !!t);
    }
  } catch {
    teams = [];
  } finally {
    clearTimeout(timer);
  }

  // Cache the outcome either way — empty results are negative-cached (short TTL
  // via readCached) so a dead source doesn't re-hit the network every load.
  try {
    await store.set(CACHE_KEY, {fetchedAt: now(), payload: teams});
  } catch {
    // non-fatal
  }
  return teams;
}

/** Species-set signature (order-independent) for dedup. */
function signature(team: Team): string {
  return team.data
    .map(m => m.species)
    .sort()
    .join('|');
}

/** Concatenate teams, dropping any whose species set already appeared. */
export function mergeTeams(...groups: Team[][]): Team[] {
  const seen = new Set<string>();
  const out: Team[] = [];
  for (const group of groups) {
    for (const team of group) {
      const sig = signature(team);
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push(team);
    }
  }
  return out;
}

/**
 * Drop any team the current ruleset no longer allows — e.g. a species
 * suspended to Ubers after a source's snapshot was taken. The crob.at/vendored
 * build pipeline already validates before including a team (see `toTeam`
 * above); this closes the same gap for `data.pkmn.cc`'s `/teams` resource,
 * which is fetched fresh on every load and isn't guaranteed to be revalidated
 * against ban changes upstream.
 */
function dropIllegal(teams: Team[], validator: TeamValidator): Team[] {
  return teams.filter(team => {
    try {
      return (validator.validateTeam(team.data.map(teamMemberToSet) as never) ?? []).length === 0;
    } catch {
      return false;
    }
  });
}

/**
 * The full opponent pool for a client: the built-in `/teams` set, the
 * **vendored** sample teams (`vendored-teams.gen9ou.json`, built server-side by
 * scripts/build-sample-teams.ts), and the **mined** high-ladder teams
 * (`mined-teams.gen9ou.json`, built by scripts/mine-ladder-teams.ts) — all
 * re-validated against the current ruleset, deduped.
 *
 * This is synchronous once `client.teams()` resolves — no runtime network fetch,
 * so it can never stall "Dealing your first hand…" or CORS-fail in the browser
 * (the reasons the old crob.at runtime fetch never populated the pool live).
 */
export async function loadOpponentTeams(client: DataClient): Promise<Team[]> {
  const base = await client.teams();
  const validator = new TeamValidator('gen9ou');
  return mergeTeams(
    dropIllegal(base, validator),
    dropIllegal(vendoredTeams, validator),
    dropIllegal(minedTeams, validator)
  );
}
