# AI improvements round 2 — self-play noise check, samplesPerCell, joint eval tuning, MCTS prototype

Four follow-ups from the post-release AI-quality review, run in the order
that lets each inform the next. Protocol for every A/B below matches
`logs/ai-round-report.md`: `scripts/sim-ai-ab.ts` (or a purpose-built
variant of it), sides swapped every other battle, teams rotated through
`test/fixtures/gen9ou.teams.full.json`. **The accept bar is ≥20/40 (wins +
draws/2) — "non-negative," not "clearly better."** At n=40 a result needs
roughly ≥26/40 to be a genuinely significant win (p<0.05 two-sided); numbers
in the low-to-mid 20s are inside the noise floor and are reported as such
below, not oversold as validated wins.

## 1. Is the self-play imbalance from `logs/gate-report.md` real?

`gate-report.md`'s 30-game d1 self-play balance came back P1 11 — P2 19
(37% P1), flagged there as statistical noise (p≈0.10 two-sided, not
significant) but never re-checked at a size that could actually settle it.

Re-ran at 10x the sample (2 parallel 150-game batches, same job/team-rotation
shape as `measure.ts`'s balance check, offsets 1000 and 5000 so the batches
don't share seeds): combined **P1 142 — P2 158 (300 games, 0 draws)** — 47.3%
P1, z≈-0.92 vs the 50/50 null. Squarely consistent with a balanced solver.

**Verdict: noise, not a bug.** No code change. The solver/eval's exact
zero-sum invariants (already unit-tested) hold up in bulk self-play too.

## 2. `samplesPerCell`: was it ever wired up, and does raising it help?

Turned out `samplesPerCell` was a config field with no consumer — `cellValue`
in `src/search/search.ts` took exactly one chance-draw (`makeJointChoice`)
per matrix cell and evaluated it directly; a single miss/crit/proc stood in
for the whole outcome distribution. Implemented the averaging: `cellValue`
now runs `cfg.samplesPerCell` independent draws of the same cell (distinct
RNG forks via `SAMPLE_STRIDE`) and averages the result; `samplesPerCell: 1`
is bit-for-bit the original single-draw path (regression-tested in
`test/search/search.test.ts`).

### Cost (empirical, 8 battles/setting, FAST config, symmetric)

| samplesPerCell | s/battle | ms/decision | multiplier |
|---|---|---|---|
| 1 | 1.72 | 44 | 1× |
| 2 | 3.00 | 76 | 1.74× |
| 3 | 4.63 | 113 | 2.69× |

### Strength (config=fast unless noted)

| matchup | score | decided win rate | verdict |
|---|---|---|---|
| samples=2 vs samples=1 | 22/40 | 55% | ACCEPT (non-negative) |
| samples=3 vs samples=1 | 25/40 | 63% | ACCEPT, borderline-significant |
| **samples=3 vs samples=2 (direct)** | **23/40** | **57%** | **wash — not significant** |
| samples=2 vs samples=1, config=strong | 3/10 | 30% | REJECT (n=10, too small to trust, but directionally negative) |

Both 2 and 3 clear "non-negative" against the shipped samples=1 baseline,
consistent with the noise-smoothing rationale. But the direct 3-vs-2
head-to-head — the comparison that actually decides what to ship — came back
a wash, while 3 costs 2.69x a single draw against 2's 1.74x. **Shipped
`FAST.samplesPerCell: 1 → 2`**: same strength as 3 within noise, for less
than two-thirds the added cost, on the config whose whole job is "shallow
and fast" (`Test-your-team bulk budget`). `STRONG` (the cinematic
"Can you 6-0?" default) stays at `samplesPerCell: 1` — its own A/B at
samples=2 lost (30%, though only n=10), and doubling the already-most-expensive
tier's per-decision cost for an unproven gain isn't worth it without a much
bigger dedicated test.

Live-difficulty check: the shipped app defaults to `STRONG`
(`src/app/sixoh/devParams.ts`) for the player, and per-mode blunder ramps
(`src/app/sixoh/session.ts`) decide FAST vs STRONG for opponents rung by
rung. This is NOT uniform across modes, and the first draft of this section
wrongly generalized from Easy's ramp — corrected:

- **Easy** (`EASY_BLUNDER = [0.75, 0.55, 0.4, 0.25, 0.1, 0]`): heavy blunders
  on the FAST-driven early rungs, so search quality there is a minor
  contributor next to the blunder rate — this mode's difficulty is
  effectively insulated from the samplesPerCell change.
- **Gym Leader** (`GYMLEADER_BLUNDER = [0.08, 0.05, 0.02, 0, 0, 0]`) —
  the mode this session's difficulty tuning targeted — blunders only 2-8%
  on its FAST rungs (indices 0-2; `opponentPolicy`'s `epsilon <= 0`
  short-circuit means indices 3-5 get pure `STRONG`, not FAST, so only
  battles 1-3 are affected at all). An 8% blunder rate is nowhere near
  "search quality barely matters" — those 3 rungs are near-full-strength
  FAST play, and this is exactly where the samplesPerCell bump lands.

Ran the confirmatory check anyway (`scripts/sim-gauntlet.ts --modes gymleader
--runs 15`, same seed/draft/ramp as the committed baseline, one battle
skipped both times on an unrelated pre-existing harness flake — a trapped
Pokémon hitting an unavailable switch choice — so both are n=14):

| | flawless | rung1 | rung2 | rung3 | rung4 | rung5 | rung6 | deaths by rung (1-6) |
|---|---|---|---|---|---|---|---|---|
| before (`logs/gate-report.md`-era baseline) | 57% (8/14) | 100% | 100% | 100% | 93% | 85% | 73% | 0,0,0,1,2,3 |
| after (`samplesPerCell: 2`) | 64% (9/14) | 100% | 100% | 93% | 100% | 100% | 69% | 0,0,1,0,0,4 |

Flawless rate went *up*, not down — and the only rung showing a new death is
rung 3, one of the three rungs this change actually touches (indices 0-2,
under an 8/5/2% blunder). But that's a single battle at n=14 (93% vs 100%
survival, i.e. one loss where there were zero before) — noise-floor stuff,
especially given the samples=2-vs-1 A/B itself came back statistically
indistinguishable from a coin flip (55%, n=40) and couldn't even confirm the
opponent got measurably stronger in a fair fight. Most deaths are still
clustered at rung 6 (STRONG, untouched) in both runs, which is where the
mode's real difficulty cliff lives. The flips aren't one-directional either:
rung 3 lost a run that used to survive, but rungs 4 and 5 each *gained* one
that used to die — if `samplesPerCell: 2` had systematically strengthened
these opponents, every flip should favor them, not split both ways. That
pattern reads as same-seed RNG-cascade reshuffling (a different early
outcome sends the run down a different branch downstream), not a real
strength delta. (Caveat: this sim runs `player=fast` too, so it's not the
exact live matchup — the live player is `STRONG`, unaffected by this change,
and rungs 1-3 held 100% survival even at the weaker FAST player level, so a
STRONG player clears them at least as easily.) **Not re-tuning
`GYMLEADER_BLUNDER`** off this — a real regression would need to show up as
a *repeated, one-directional* pattern of early deaths across more runs, not
a single bidirectional swing this size.

## 3. Joint eval-weight tuning: does tuning together beat one-at-a-time?

The 5 weights actually exposed for A/B testing (`EvalOverrides`:
`teraAvailable`, `teraDecayFaints`, `statusThreatWeight`, `sweeperDangerWeight`,
`speedTierWeight`) were each tuned individually in earlier rounds. Wrote
`scripts/sim-eval-joint.ts`: samples random combinations within ±40-50% of
the shipped defaults, A/B's each against the shipped defaults head-to-head.

Screening pass: 8 candidates × 10 battles (config=fast, seed=42) —

| rank | score | teraAvail | teraDecay | statusThreat | sweeperDanger | speedTier |
|---|---|---|---|---|---|---|
| 1 | 6/10 | 64.13 | 8.00 | 0.69 | 16.34 | 3.29 |
| 2 | 6/10 | 52.02 | 5.96 | 0.63 | 9.11 | 4.33 |
| 3 | 6/10 | 30.90 | 8.24 | 0.80 | 16.14 | 3.54 |
| 4–8 | 4–5/10 | — | — | — | — | — |

_(baseline: TERA_AVAILABLE=50, TERA_DECAY_FAINTS=8, STATUS_THREAT=0.6,
SWEEPER_DANGER=12, SPEED_TIER=3; full table in `logs/eval-joint-search.md`)_

Best candidate scored 6/10 — one win above chance, nowhere near significant
at n=10. **No candidate showed a real signal.** This is a screening pass,
not a rejection of the hypothesis (a proper answer would need each
candidate confirmed at n=40, which multiplies cost by the candidate count),
but within the timebox for this item, the honest read is: the existing
one-at-a-time-tuned defaults already sit at or near a reasonable joint
operating point, at least within ±50% of their current values. **No change
shipped.**

## 4. MCTS / Decoupled UCT prototype

Built a decoupled-UCT prototype for the root simultaneous-move decision:
each side runs an independent UCB1 bandit over its own `rootCandidates()`
(the same action set the shipped matrix search uses), refined over a fixed
playout budget matched to the shipped d2 search's node cost (~220, vs
`gate-report.md`'s measured d2 `nodesPerDecision` ≈ 200). Each playout is one
joint transition + a depth-1-style static eval (no interior expansion) —
repeated visits to the same action pair land on independent RNG forks, so
this doubles as chance-node smoothing (the same benefit item 2 targets) on
top of the search-allocation question.

A/B'd head-to-head against the shipped `STRONG` (d2) search, budget=220,
explorationC=80, config=strong, 32 battles total (2×16, offsets 0/200 for
independent seeds):

| batch | NEW(mcts) − OLD(search) | score | win rate |
|---|---|---|---|
| A | 5 − 11 | 5/16 | 31% |
| B | 3 − 13 | 3/16 | 19% |
| **combined** | **8 − 24** | **8/32** | **25%** |

**Clear REJECT** — this isn't close to noise-floor ambiguous the way items 2
and 3 were. Plain decoupled UCT with a single shallow eval per playout loses
decisively to the shipped depth-2 matrix search at a matched node budget.
Plausible reason: the shipped search's saddle-point bracketing
`(maxmin + minmax)/2` over a fully-enumerated interior grid gives a more
robust per-cell value estimate than MCTS's raw mean-reward/visit-count
statistics do at this small an action space (root candidates are ~4-8 per
side) — the adversarial, simultaneous-move setting is exactly where plain
UCB1 (built for single-agent stochastic bandits) is known to struggle
without added machinery (regret matching, exploitability-aware refinement).
`explorationC=80` was a single reasoned guess, not swept — a hyperparameter
search might close some of this gap, but an 8/32 combined result is well
outside the range a plausible C or budget retune would flip to a win.

**Verdict: don't pursue a full custom fast-transition-model rewrite on this
evidence.** The current shallow expectiminimax + matrix-solve architecture
is doing something a naive MCTS port doesn't replicate cheaply, and the
cost of testing that (this prototype) was small relative to the cost of
committing to a rewrite first. **The prototype code has been removed**
(`src/search/mcts.ts`, the `Policy` union's `mcts` kind and its
`runner.ts` wiring, `test/search/mcts.test.ts`, `scripts/sim-mcts-ab.ts`) —
it was net-new application surface for a rejected experiment, not a reusable
tuning lever, so per this repo's convention of documenting losses in prose
(see `rootSwitchK`'s reversion in `logs/ai-round-report.md`) rather than
leaving dead code live, this document is the sole surviving record.

## Net outcome

- Self-play balance: confirmed sound at n=300, no fix needed.
- `FAST.samplesPerCell: 1 → 2` (shipped) — non-negative vs 1, a wash vs 3,
  cheaper than 3. `STRONG` unchanged.
- Joint eval-weight tuning: no gain found in a screening pass; no change.
- MCTS prototype: built, tested, decisively rejected (25% over 32 battles);
  removed from the tree after documenting here.
