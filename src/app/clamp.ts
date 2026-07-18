/**
 * Clamp a typed battle count to the run picker's contract: within [min, 500],
 * rounded to the slider's step of 10. Returns NaN for non-finite input — the
 * caller reverts to the current value.
 */
export function clampN(value: number, min: number): number {
  if (!Number.isFinite(value)) return NaN;
  return Math.min(500, Math.max(min, Math.round(value / 10) * 10));
}
