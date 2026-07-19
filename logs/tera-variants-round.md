# AI round report — rootTeraVariants 2→3 (Round 1 follow-on)

Round 1 (`logs/tera-defense-round.md`) added a new competitor class —
defensive Tera+Status plays — into the same top-`rootTeraVariants` cut that
Tera'd attacks already compete for. That raised an obvious follow-up
question: is 2 root Tera slots now too narrow, with a genuinely useful third
class of candidate fighting for the same two spots? This is exactly the
`rootSwitchK` precedent from `logs/ai-round-report.md`: a widening lever,
tested as a real experiment that can lose, not shipped as a default bump.

## Change

- `src/search/config.ts`: `FAST.rootTeraVariants` 2 → 3 (`STRONG` inherits).
- `test/search/candidates.test.ts`: the Round 0 regression scenario (exactly
  3 Tera candidates competing for slots) now pins `rootTeraVariants: 2`
  explicitly in its own local config rather than inheriting `FAST`'s value,
  so it keeps isolating `teraDefenseWeight` specifically regardless of what
  the shipped root-breadth default is — otherwise, with 3 slots and only 3
  candidates in that scenario, the cut never prunes anything and the test
  stops demonstrating the lever it's named for.

## Validation (`scripts/sim-tera-variants-ab.ts`, 40 battles, config=fast)

Protocol: NEW (`rootTeraVariants: 3`) vs OLD (`=2`, the pre-round shipped
default), sides swapped every other battle, teams rotated through
`test/fixtures/gen9ou.teams.full.json`, `battleSeed = seedFromInts(i+1..i+4)`,
`searchSeed = 13000+i`.

| metric | result |
|---|---|
| NEW wins − OLD wins (draws) | 25 − 15 (0) |
| NEW score (wins + draws/2) | **25/40** |
| decided win rate | **63%** |

Comfortably clears the ≥20/40 accept bar — this isn't an ambiguous result.

## Cost gate

`logs/browser-results.json` (the actual browser-driven measurement) is
stale from before this session and wasn't re-run (it requires a separate
Playwright-driven harness, `scripts/measure-browser.mjs`); its numbers in
`logs/gate-report.md` are therefore unchanged and don't reflect this
change. Following the same extrapolation the `ai-round-report.md` round
used (browser cost ≈ Node cost × a roughly constant browser/Node ratio),
the live signal is the Node-side delta between two clean runs on this
machine, same conditions:

| metric | before (rootTeraVariants=2) | after (=3) | delta |
|---|---|---|---|
| d1 FAST ms/decision mean (Node) | 32.8 | 37.5 | +14% |
| d2 STRONG ms/decision mean (Node) | 221.0 | 277.9 | +26% |
| d1 vs random | 100% | 100% | — |
| d2 vs d1 | 65% | **75%** | +10pp |

A one-candidate root widening (root matrix grows from 8×8 to 9×9, ~+27%
cells) producing a +14–26% Node cost delta is in line with expectations,
with wide headroom under the browser gate's absolute thresholds (150ms/2s)
starting from a stale-but-still-relevant 60.7ms/466.7ms baseline — a
4.3× swing would be needed to threaten the d2 threshold alone. Full test
suite green throughout (37 files / 231 tests).

## Outcome

**ACCEPT.** Shipped as the `FAST`/`STRONG` default (`rootTeraVariants: 3`).
A decisive win (63% of decided, not a coin flip, unlike the `rootSwitchK`
lever which lost its equivalent widening experiment), no cost-gate concern,
and both self-play/vs-random strength gates unmoved or improved.
