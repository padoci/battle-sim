/**
 * Wilson-score interval half-width for a binomial proportion: the "±X%"
 * on the live win rate. Wilson (not the naive normal approximation) so the
 * readout stays honest at small n and extreme rates, which is exactly when
 * a run-until-stopped user is deciding whether to keep going.
 */
export function wilsonHalfWidth(p: number, n: number, z = 1.96): number {
  if (n <= 0) return 1;
  const zz = (z * z) / n;
  return (z * Math.sqrt((p * (1 - p)) / n + zz / (4 * n))) / (1 + zz);
}

/** Matchup cards under this many battles get a "thin sample" tag. */
export const THIN_SAMPLE_BATTLES = 20;
