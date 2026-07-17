/** Throughput measurement + ETA projection (ui-spec §5b/§5c). */

export const CALIBRATION_BATTLES = 10;

/** Median — robust to a single maxTurns outlier in the calibration batch. */
export function medianMs(samples: number[]): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Projected remaining time for a total of `n` battles when `done` have
 * completed and per-battle cost is `msPerBattle`.
 *
 * Note the deliberate conservative bias: calibration battles each pay a
 * first-time CalcTable build, while steady-state battles reuse tables — so
 * early estimates overshoot slightly. Safe direction ("direction, not gospel").
 */
export function etaMs(n: number, done: number, msPerBattle: number): number {
  return Math.max(0, n - done) * msPerBattle;
}

/** EMA update for live re-estimation from actual throughput (§5c). */
export function updateEma(previous: number, latestMs: number, alpha = 0.2): number {
  return previous <= 0 ? latestMs : alpha * latestMs + (1 - alpha) * previous;
}

/** "≈ 4 min" style display string. */
export function formatEta(ms: number): string {
  if (ms < 45_000) return `≈ ${Math.max(5, Math.round(ms / 5000) * 5)} s`;
  const minutes = ms / 60_000;
  if (minutes < 10) return `≈ ${Math.max(1, Math.round(minutes * 2) / 2)} min`;
  return `≈ ${Math.round(minutes)} min`;
}
