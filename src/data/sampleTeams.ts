import {Teams, TeamValidator} from '@pkmn/sim';
import type {KVStore} from './cache';
import {openStore} from './cache';
import type {DataClient} from './client';
import {setToTeamMember} from './team';
import type {PokemonSet, Team} from './types';

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
/** Cap the fan-out: bounded fetches, aggressively cached. */
const MAX_TEAMS = 30;
const CONCURRENCY = 6;

export interface SampleTeamsOptions {
  store: KVStore;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Override the index URL (tests). */
  indexUrl?: string;
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

async function resolveExport(ref: SampleRef, fetchFn: typeof fetch): Promise<ResolvedExport | undefined> {
  if (ref.paste) return {text: ref.paste, title: ref.title, author: ref.author};
  if (!ref.url) return undefined;
  const jsonUrl = `${ref.url.replace(/\/+$/, '')}/json`;
  try {
    const res = await fetchFn(jsonUrl);
    if (!res.ok) return undefined;
    const body = (await res.json()) as {paste?: string; title?: string; author?: string};
    if (!body.paste) return undefined;
    return {text: body.paste, title: ref.title ?? strOrNull(body.title), author: ref.author ?? strOrNull(body.author)};
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

export async function fetchSampleTeams(opts: SampleTeamsOptions): Promise<Team[]> {
  const {store, fetchFn = fetch, now = Date.now, indexUrl = SAMPLES_INDEX} = opts;

  try {
    const cached = await store.get(CACHE_KEY);
    if (cached && now() - cached.fetchedAt < TTL_MS) return cached.payload as Team[];
  } catch {
    // cache miss / unusable store — fetch fresh
  }

  let teams: Team[] = [];
  try {
    const res = await fetchFn(indexUrl);
    if (res.ok) {
      const refs = toArray(await res.json())
        .map(toRef)
        .filter((r): r is SampleRef => !!r)
        .slice(0, MAX_TEAMS);
      const validator = new TeamValidator('gen9ou');
      const exports = await mapPool(refs, CONCURRENCY, ref => resolveExport(ref, fetchFn));
      teams = exports
        .filter((e): e is ResolvedExport => !!e)
        .map(e => toTeam(e, validator))
        .filter((t): t is Team => !!t);
    }
  } catch {
    teams = [];
  }

  // Only cache a non-empty result: a transient failure should retry next time,
  // not be pinned as "no samples" for the full TTL.
  if (teams.length > 0) {
    try {
      await store.set(CACHE_KEY, {fetchedAt: now(), payload: teams});
    } catch {
      // non-fatal
    }
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
 * The full opponent pool for a client: the built-in `/teams` set plus the
 * runtime-fetched sample teams, deduped. Never rejects on the sample path.
 */
export async function loadOpponentTeams(
  client: DataClient,
  opts: Partial<SampleTeamsOptions> = {}
): Promise<Team[]> {
  const base = await client.teams();
  let samples: Team[] = [];
  try {
    const store = opts.store ?? (await openStore());
    samples = await fetchSampleTeams({...opts, store});
  } catch {
    samples = [];
  }
  return mergeTeams(base, samples);
}
