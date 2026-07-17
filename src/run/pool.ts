import type {PokemonSet} from '../data/types';

/** One opponent team in the configured pool (ui-spec §5a). */
export interface PoolEntryConfig {
  teamId: string;
  teamName: string;
  team: PokemonSet[];
  /** Relative battle frequency; 0 or disabled = never fought. */
  weight: number;
  enabled: boolean;
}

export interface SwrrState {
  entries: Array<{teamId: string; weight: number; current: number}>;
  totalWeight: number;
}

/**
 * Smooth weighted round-robin (nginx-style). Chosen because it stays
 * proportional at EVERY prefix of the schedule — so a cancelled or
 * partially-complete run is still representative of the configured pool
 * mix, and the ~10-battle calibration slice doubles as a fair sample.
 */
export function initSwrr(pool: PoolEntryConfig[]): SwrrState {
  const enabled = pool.filter(e => e.enabled && e.weight > 0);
  return {
    entries: enabled.map(e => ({teamId: e.teamId, weight: e.weight, current: 0})),
    totalWeight: enabled.reduce((sum, e) => sum + e.weight, 0),
  };
}

/** Next opponent teamId; mutates the state. Throws on an empty pool. */
export function nextTeam(state: SwrrState): string {
  if (!state.entries.length) throw new Error('opponent pool is empty');
  for (const entry of state.entries) entry.current += entry.weight;
  let picked = state.entries[0];
  for (const entry of state.entries) {
    if (entry.current > picked.current) picked = entry;
  }
  picked.current -= state.totalWeight;
  return picked.teamId;
}

/** Draw the next `count` teamIds (mutates state — resume-friendly). */
export function drawSchedule(state: SwrrState, count: number): string[] {
  return Array.from({length: count}, () => nextTeam(state));
}
