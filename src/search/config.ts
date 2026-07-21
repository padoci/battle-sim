/** Tunables for the v1 shallow-expectiminimax search (search spec §4/§7). */
export interface SearchConfig {
  /** 1 = greedy joint matrix; 2 = pessimistic interior layer under each cell. */
  depth: 1 | 2;
  /** Max unforced switch candidates per side at the root. */
  rootSwitchK: number;
  /** Tera variants added at the root (top moves by tera-slice threat). */
  rootTeraVariants: number;
  /**
   * Ranking-only weight added to a Status-category Tera candidate's score
   * for how much terastallizing reduces the opponent's current best
   * incoming threat (same koProb+chip units as moveThreat). 0 = old,
   * offense-only Tera ranking — see scripts/sim-tera-defense-ab.ts.
   */
  teraDefenseWeight: number;
  /** Minimum defensive-threat reduction (threat units) before the above
   *  bonus applies — avoids noise-driven reordering on marginal turns. */
  teraDefenseThreshold: number;
  /** Candidates per side in the d2 interior layer. */
  interiorCandidates: number;
  /** Sim samples averaged per matrix cell (chance handling; 1 = rely on eval smoothing). */
  samplesPerCell: number;
  /** Eval MATCHUP weight at leaves of total depth 1 / depth 2 (spec §4a taper). */
  matchupWeightByDepth: [number, number];
  /** Fictitious-play iterations for the root equilibrium solve. */
  solverIterations: number;
  /** Mixed-strategy support cleanup threshold. */
  epsilonPrune: number;
  /** A switch is kept only if switchScore > stayScore - margin (eval points). */
  switchMargin: number;
}

/** Test-your-team bulk budget: shallow and fast. */
export const FAST: SearchConfig = {
  depth: 1,
  // Kept at 2: widening to 3 lost the head-to-head A/B (19/40, breadth
  // lever in logs/ai-round-report.md) — the extra switch branch dilutes the
  // root equilibrium more than it helps at this depth.
  rootSwitchK: 2,
  // Widened 2->3: Round 1 added a new competitor (defensive Tera+Status)
  // for the same slots Tera attacks already fill, and 3 won its A/B 25/40
  // (63% of decided) — see logs/tera-variants-round.md.
  rootTeraVariants: 3,
  // Shipped default: won its A/B 22/40 (55% of decided) with a confirmed-live
  // behavioral probe (logs/tera-defense-round.md) — Tera+Status/setup lines
  // now compete for a root tera slot on defensive merit, not just offense.
  teraDefenseWeight: 1,
  teraDefenseThreshold: 0.3,
  interiorCandidates: 3,
  // 1->2: averaging independent chance-draws per root cell smooths the
  // single-RNG-roll noise a depth-1 leaf eval is otherwise fully exposed to
  // (miss/crit/proc standing in for the whole distribution) — non-negative
  // vs samplesPerCell=1 (22/40, 55% of decided). 3 samples costs 2.69x a
  // single draw (vs 2's 1.74x) for a 3-vs-2 head-to-head that came back
  // 23/40 — a wash, not a win — so 2 ships as the cheaper, equally-strong
  // option; see logs/ai-improvements-round-2.md. STRONG's d2 interior layer
  // already gets a similar effect from minimax bracketing over the interior
  // grid, and doubling samplesPerCell there LOST its own (smaller, n=10)
  // A/B — left at 1 for STRONG.
  samplesPerCell: 2,
  matchupWeightByDepth: [20, 10],
  solverIterations: 2000,
  epsilonPrune: 0.03,
  switchMargin: 5,
};

/** "Can you 6-0?" cinematic budget: depth 2 with the same root breadth. */
export const STRONG: SearchConfig = {...FAST, depth: 2};
