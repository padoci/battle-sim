# AI round report — "smarter d1" (feedback round 4, PR-B close-out)

PR #20 shipped three eval terms (status-aware threat, sweeper danger, speed
tiers) plus a wider root (`FAST.rootSwitchK 2→3`), each gated behind
`EvalOverrides` so the old brain stays reproducible bit-for-bit. This report
records the per-lever A/B verdicts and the cost/sanity gates, and lands the
one correction the data demanded: **the breadth widening lost its A/B and is
reverted** (`rootSwitchK` back to 2).

Protocol: `scripts/sim-ai-ab.ts` — 40 battles per lever, sides swapped every
other battle, teams rotated through `test/fixtures/gen9ou.teams.full.json`,
`battleSeed = seedFromInts(i+1..i+4)`, `searchSeed = 9000+i`, config=fast.
Accept iff NEW score (wins + draws/2) ≥ 20/40.

## Per-lever verdicts

| lever | NEW − OLD (draws) | NEW score | decided win rate | verdict |
|---|---|---|---|---|
| **eval** (3 new terms vs zeroed) | 23 − 17 (0) | 23/40 | **57%** | **ACCEPT** |
| **breadth** (rootSwitchK 3 vs 2) | 19 − 21 (0) | 19/40 | 48% | **REJECT → reverted** |
| **all** (new brain vs old brain) | 23 − 17 (0) | 23/40 | **57%** | **ACCEPT** |

Full tables: `logs/ai-ab-{eval,breadth,all}.md`.

Reading: the strength gain comes entirely from the eval terms — the AI now
values Will-O-Wisp/Thunder Wave/Toxic/hazards/setup instead of scoring every
Status move 0, is scared of boosted opposing sweepers, and prefers speed
control. The third root switch diluted the root equilibrium more than it
helped at depth 1, so shipped `FAST` keeps `rootSwitchK: 2` (STRONG inherits).

## Cost gate (scripts/measure.ts, Node, new eval at the pre-revert K=3 —
an upper bound for the shipped K=2)

| metric | old (gate-report.md) | new | gate | status |
|---|---|---|---|---|
| d1 FAST ms/decision mean | 105.6 | 131.1 (1.24×) | ≤ ~2× old | ✅ |
| d2 STRONG ms/decision mean | 685.4 | 980.9 (1.43×) | browser ≤ ~2 s/turn | ✅ (browser ≈ 0.7× Node) |
| d1 vs random | 100% | 100% | ≥ 90% | ✅ |
| d2 vs d1 | 70% | **70%** | ≥ 55% | ✅ |
| root mixing entropy | 0.38 bits | 0.46 bits | — | still mixes |

The committed `logs/gate-report.md` intentionally keeps the pre-round
numbers; re-run `scripts/measure.ts` on main to refresh it at the shipped
config when next needed.

## Easy-ramp sanity (scripts/sim-gauntlet.ts, 12 runs, modes=easy, fast,
shipped post-revert config)

Early rungs stay clearly winnable under the stronger brain: rung 1 **92%**,
rung 2 **100%**, then 64% / 57% / 50% / 50% — the difficulty cliff still
lives in the back half where it belongs. `EASY_BLUNDER` needs no
recalibration.

## Net outcome

- New brain beats the old brain **57%** head-to-head at the dashboard's d1.
- Shipped deltas vs pre-round: the three eval terms (on by default),
  status-aware candidate ranking, `rootSwitchK` unchanged at 2.
- Cost within budget at both depths; Easy mode unharmed.
