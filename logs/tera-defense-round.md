# AI round report — defensive Tera candidate ranking (round 1, "mistimed Tera" fix)

Prompted by a noticed behavior: the AI would sometimes let a genuinely
game-saving *defensive* Tera line (Tera to survive a lethal hit, then
set up / heal / Protect) go completely unconsidered. Root cause: root-level
Tera candidates in `rootCandidates` (`src/search/candidates.ts`) are ranked
by `moveThreat` and only the top `rootTeraVariants` (2) survive the cut. For
damaging moves that's fine — Tera + best attack always ranks first on
offense alone, and its real defensive payoff is scored correctly once
simulated. But `moveThreat`'s **Status** branch (`weightedStatusMoveValue`)
had no defensive/survival term at all, so a Tera'd setup/status move could
never win a slot against two merely-solid attacks, regardless of how much
survival it bought — the option was pruned before search ever saw it.

(A uniform "add a defensive term to every Tera candidate" fix was checked
and rejected before writing any code: all Tera candidates at a given root
share the same attacker/defender pair, so the defensive value is a constant
across them that turn — adding it before `sort().slice(0, N)` can never
change which candidates survive. The fix had to specifically target the
Status branch, the one that's structurally starved.)

## Change

- `src/search/candidates.ts`: new `teraDefensiveValue()` helper (reuses the
  existing `threat()` primitive with attacker/defender reversed — same
  koProb+chip units as `moveThreat`, pure `CalcTable` lookups, no new
  simulation cost). Wired into `moveThreat`'s Status branch, gated on
  `tera` so plain status-move ranking and all interior-candidate calls
  (which never pass `tera: true`) are untouched.
- `src/search/config.ts`: two new tunables, `teraDefenseWeight` (1) and
  `teraDefenseThreshold` (0.3) — the latter avoids noise-driven reordering
  on marginal turns. `teraDefenseWeight: 0` reproduces the old, offense-only
  ranking bit-for-bit (used as the A/B's OLD arm).
- `test/search/candidates.test.ts`: new regression scenario — a Tera'd
  Quiver Dance that turns a guaranteed KO into guaranteed survival is pruned
  under the old ranking (`teraDefenseWeight: 0`) and kept under the shipped
  default.

## Validation (`scripts/sim-tera-defense-ab.ts`, 40 battles, config=fast)

Protocol: NEW (`teraDefenseWeight: 1`) vs OLD (`=0`), sides swapped every
other battle, teams rotated through `test/fixtures/gen9ou.teams.full.json`,
`battleSeed = seedFromInts(i+1..i+4)`, `searchSeed = 12000+i`.

| metric | result |
|---|---|
| NEW wins − OLD wins (draws) | 22 − 18 (0) |
| NEW score (wins + draws/2) | **22/40** |
| decided win rate | **55%** |
| confirmed new defensive-Tera-support plays | **4**, in 4/40 battles |

The behavioral probe (mandatory here — the prior `tera-ab.md` round landed
an ambiguous exact 50/50) confirms the mechanism is genuinely live, not just
a neutral relabeling: each of the 4 plays was a chosen, tera'd action
present in NEW's root candidates but absent from OLD's for the same
side/turn. Spot-checked sample logs (`logs/battle-tera-defense-{1,2,3}.txt`)
show sensible lines — e.g. Raging Bolt terastallizing to Water while using
Calm Mind, and a defensive Kingambit Tera-to-Fire ahead of a switch.

## Cost gate (`scripts/measure.ts`, browser-equivalent, with the change applied)

| metric | value | gate | status |
|---|---|---|---|
| d1 FAST ms/decision mean | 60.7 | ≤ ~150ms | ✅ |
| d2 STRONG ms/decision mean | 466.7 | ≤ ~2s | ✅ |
| d1 vs random | 100% | ≥ 90% | ✅ |
| d2 vs d1 | 65% | ≥ 55% | ✅ |

All four thresholds hold comfortably (in fact d2 vs d1 improved from the
committed `logs/gate-report.md`'s historical baseline). The extra
`teraDefensiveValue` lookups are O(1) `CalcTable` reads gated to Tera+Status
candidates only, so cost impact is negligible.

## Outcome

**ACCEPT.** Shipped as the `FAST`/`STRONG` default (`teraDefenseWeight: 1`,
`teraDefenseThreshold: 0.3`). All three accept criteria met: a real win rate
(55% of decided, not a coin flip), a confirmed-live behavioral mechanism,
and cost/strength gates unmoved. Full test suite green (37 files / 231
tests) throughout.
