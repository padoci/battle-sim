/** Tunables for the v1 shallow-expectiminimax search (search spec §4/§7). */
export interface SearchConfig {
  /** 1 = greedy joint matrix; 2 = pessimistic interior layer under each cell. */
  depth: 1 | 2;
  /** Max unforced switch candidates per side at the root. */
  rootSwitchK: number;
  /** Tera variants added at the root (top moves by tera-slice threat). */
  rootTeraVariants: number;
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
  rootTeraVariants: 2,
  interiorCandidates: 3,
  samplesPerCell: 1,
  matchupWeightByDepth: [20, 10],
  solverIterations: 2000,
  epsilonPrune: 0.03,
  switchMargin: 5,
};

/** "Can you 6-0?" cinematic budget: depth 2 with the same root breadth. */
export const STRONG: SearchConfig = {...FAST, depth: 2};
