/** Format ids we fetch data for. v1 is Gen 9 OU only. */
export type FormatId = 'gen9ou';

export type Resource = 'sets' | 'stats' | 'teams';

/** Canonical source. */
export const PRIMARY_BASE = 'https://data.pkmn.cc';

/**
 * Byte-identical mirror (the pkmn/smogon repo data.pkmn.cc is generated
 * from). Used as a fallback when the primary is unreachable.
 */
export const MIRROR_BASE = 'https://raw.githubusercontent.com/pkmn/smogon/main/data';

/** Path for a resource — shared by primary and mirror URLs. */
export function resourceKey(resource: Resource, format: string): string {
  return `${resource}/${format}.json`;
}

/**
 * Bumping this orphans every cached entry. Do it whenever what counts as a
 * VALID payload changes — otherwise a user who cached a wrong-shaped body
 * before the shape check existed keeps being served it for a full TTL, with
 * no in-app way to clear it. v2: shape validation introduced.
 */
export const CACHE_SCHEMA = 'v2';

/**
 * Logical cache key. Separate from `resourceKey` because that one is also the
 * URL path — a version prefix there would 404.
 */
export function cacheKey(resource: Resource, format: string): string {
  return `${CACHE_SCHEMA}/${resourceKey(resource, format)}`;
}

/** URLs to try in order for a resource. */
export function resourceUrls(resource: Resource, format: string): string[] {
  const key = resourceKey(resource, format);
  return [`${PRIMARY_BASE}/${key}`, `${MIRROR_BASE}/${key}`];
}
