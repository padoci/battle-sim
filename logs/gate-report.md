# Stage 2 Measurement Gate Report

**This is the go/no-go on the AI approach (HANDOFF stage 2; search spec §5).**

## Watch-for checklist (human review)

Read the battle logs in this directory and judge:
- Does it switch into obvious KOs? Does it preserve win conditions?
- Does it actually **mix/bluff** (look for p<1.00 choices), or is every turn pure?
- Is Tera timing sane — not wasted turn 1, not hoarded forever?
- Any turn where the chosen action is inexplicable given the printed root value?
- Does d1-vs-random look like a competent player beating a fish?

Suggested thresholds: browser d1 ≤ ~150 ms/turn (100-battle test-your-team run ≈ 5 min);
browser d2 ≤ ~2 s/turn (cinematic); d1 ≥90% vs random; d2 ≥55% vs d1.
If missed: pruning knobs first (interior 3×2, rootSwitchK=1), then search-spec §6 escalation.

## Table 1 — Cost

| config | runtime | ms/decision mean/p50/p95 | nodes/dec | s/battle | table ms | startup ms | battles/min |
|---|---|---|---|---|---|---|---|
| d1 FAST | Node | 105.6 / 94.1 / 261.4 | 25 | 3.6s | 195 | — | 16.8 |
| d1 FAST | browser worker | — | — | — | — | — | — |
| d2 STRONG | Node | 685.4 / 617.0 / 1672.4 | 200 | 22.3s | 195 | — | 2.7 |
| d2 STRONG | browser worker | — | — | — | — | — | — |

(browser rows are the primary gate numbers — NOT YET RUN: `node scripts/measure-browser.mjs`)

## Table 2 — Strength (Node)

| matchup | battles | result |
|---|---|---|
| d1 vs random | 40 | **100%** search wins (40) |
| d2 vs d1 | 20 | **70%** d2 wins (14, 0 draws) |
| d1 self-play balance | 30 | P1 11 — P2 19 — draws 0 |
| root mixing | — | mean strategy entropy 0.38 bits/decision |

## Battle logs

- battle-d2-selfplay-{1,2,3}.txt — STRONG self-play (watch these closest)
- battle-d1-selfplay.txt — FAST self-play
- battle-d1-vs-random.txt — sanity: competent vs fish

## Notes

- Symmetry note: exact zero-sum/mirror invariants hold at the solver and eval level
  (unit-tested); end-to-end side balance is statistical because the sim's own
  p1/p2 tie-breaks and per-cell PRNG forks differ.
- Chance handling is single-sample per matrix cell + eval smoothing
  (koProb/expectedFrac); `samplesPerCell` is the reserve knob if logs show
  noise-driven misplays.
