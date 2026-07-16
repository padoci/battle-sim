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

/** Logical cache key for a resource — shared by primary and mirror URLs. */
export function resourceKey(resource: Resource, format: string): string {
  return `${resource}/${format}.json`;
}

/** URLs to try in order for a resource. */
export function resourceUrls(resource: Resource, format: string): string[] {
  const key = resourceKey(resource, format);
  return [`${PRIMARY_BASE}/${key}`, `${MIRROR_BASE}/${key}`];
}
