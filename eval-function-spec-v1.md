# Battle AI — Evaluation Function Spec (v1)

**Status:** Locked (first component of the build plan)
**Scope:** Gen 9 OU singles first. Same eval later backs a doubles-aware search for VGC.
**Reference:** pmariglia/foul-play `showdown/engine/evaluate.py` (adopted as baseline, with the divergences in §4).

---

## 1. Purpose

A **static** evaluation function: it takes one frozen battle state and returns a single scalar score from the perspective of the side we're scoring. It does **no lookahead** — all "will this KO / who moves first" intelligence lives in the search layer that calls this function. The eval only answers *"how good is this position, right now?"*

It has two consumers:
- The **search** (expectiminimax for singles), which applies candidate moves and re-evaluates resulting states.
- The **game-plan layer**, which reuses the same matchup math to explain *why* a matchup is good or bad.

Build the eval once; both surfaces draw from it.

---

## 2. Locked design principles

1. **Static, search-agnostic.** No move simulation inside the eval. Keep calc/lookahead logic in the search, not here.
2. **Attrition model.** "Alive" + HP dominate the score; everything else is a fractional modifier. This is correct — Pokémon is fundamentally a 6v6 HP race.
3. **KO cliff = emergent aggression.** Because a live mon is worth a flat 75 before HP, taking a mon from 1% → fainted is a ~76-point swing. "Go for the kill / avoid being killed" falls out of this discontinuity — we don't hand-code it.
4. **Omniscient information model.** Both sides are fully specified objects (exact EVs, nature, item, ability). Consequence: **the damage calc is exact, not an estimate.** No spread-guessing.
5. **Zero-sum.** Score = Σ(own mons) − Σ(opponent mons) + own side-state − opponent side-state.

---

## 3. Baseline scoring terms (adopted from Foul Play)

### 3a. Per-Pokémon (`evaluate_pokemon`)

| Term | Value | Notes |
|---|---|---|
| Fainted (hp ≤ 0) | `0` | Short-circuit; nothing else scored. |
| Alive (static) | `+75` | Flat, for being on the field at all. The KO cliff. |
| HP | `+100 × (hp / maxhp)` | Scales with remaining HP. Note HP (100) is weighted *above* the alive bonus (75). |
| Attack boost | `DR[stage] × 15` | |
| Defense boost | `DR[stage] × 15` | |
| Sp. Atk boost | `DR[stage] × 15` | |
| Sp. Def boost | `DR[stage] × 15` | |
| Speed boost | `DR[stage] × 25` | Highest-weighted boost. |
| Accuracy boost | `DR[stage] × 3` | |
| Evasion boost | `DR[stage] × 3` | |
| Status | see table | |
| Volatiles | see table | |

**Diminishing-returns curve `DR[stage]`** (prevents over-valuing setup to +6):

| stage | -6 | -5 | -4 | -3 | -2 | -1 | 0 | +1 | +2 | +3 | +4 | +5 | +6 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| DR | -3.3 | -3.15 | -3 | -2.5 | -2 | -1 | 0 | 1 | 2 | 2.5 | 3 | 3.15 | 3.3 |

So +1 Spe = `1 × 25 = 25`; +6 Spe = `3.3 × 25 ≈ 82` (not 150).

**Status values:**

| Status | Value |
|---|---|
| Frozen | -40 |
| Toxic | -30 |
| Sleep | -25 |
| Paralyzed | -25 |
| Poison | -10 |
| Burn | `-25 × burn_multiplier` |
| None | 0 |

**Volatile values:**

| Volatile | Value |
|---|---|
| Substitute | +40 |
| Leech Seed | -30 |
| Confusion | -20 |

> Note: reference defines `POKEMON_HIDDEN = 10` but does **not** apply it in this version. Don't cargo-cult it — it's a fog-of-war artifact and we're omniscient anyway.

### 3b. State-level (`evaluate`)

**Static side conditions** (fixed value, scored on the side that owns them):

| Condition | Value |
|---|---|
| Aurora Veil | +40 |
| Reflect | +20 |
| Light Screen | +20 |
| Tailwind | +7 |
| Safeguard | +5 |
| Sticky Web | -25 (bad to be under) |

**Count-scored side conditions** — value **× that side's living reserve count**. This is the standout heuristic: hazards matter more with a full bench and fade as it empties.

| Hazard | Value (per living reserve) |
|---|---|
| Stealth Rock | -10 |
| Spikes | -7 |
| Toxic Spikes | -7 |

**Matchup term (baseline):** `20 × eff(myActive → oppActive) − 20 × eff(oppActive → myActive)`, where `eff` is a static type-effectiveness lookup. **This is the term we replace — see §4.**

---

## 4. Divergences (ours vs Foul Play) — the important part

### 4a. Matchup term → calc-driven, not a static type table
Replace the flat type lookup with a real damage read, because our audience is competitive and this same math powers the game-plan feature.

**Mechanism (locked):**
- **Precompute once per battle:** for each of the 12 mons, the base damage rolls of each of its moves vs each opposing mon.
- **At each search node, don't re-run the calc.** Read the cached base roll and apply cheap **scalar modifiers** for current state: ≈×1.5 per relevant attack stage, ×0.5 under screen, ×0.5 for burn (physical), weather multipliers, etc.
- Convert to **KO probability / expected damage fraction**; reward "my active threatens an OHKO on their active," penalize the reverse, **scaled by speed order** (outspeeding a KO threat is worth more than being outsped).

**This term is a horizon shortcut.** The engine computes *real* damage whenever the search actually simulates a move; this eval term exists to reward threats the search *hasn't reached yet*. Its weight should scale **inversely with search depth** — deeper search leans on it less.

### 4b. Terastallization — scored state + live search decision
- Tera is a **decision the search makes** (when/whether to Tera), not a fixed attribute.
- Each mon has exactly **one** declared Tera type, known at team-build. So precompute **two damage slices per mon** — un-Tera'd and Tera'd (a bounded 2× table expansion). The search toggles Tera and still just *reads* the table, which is what keeps "Tera in search" affordable in-browser: branching grows, per-node cost stays flat.
- Tera is **not** a clean scalar (it changes the effectiveness bucket — 2× can flip to ½× or immune), which is exactly why it needs its own precomputed slice rather than a multiplier.
- **An unused Tera is a held threat** → small standing bonus for having Tera still available (magnitude to tune — see §6).

### 4c. Omniscient scoring of all mons
Foul Play counts the opponent's *unrevealed* mons as just a headcount (it plays real ladder games blind). We know every mon, so **every mon is fully scored** (HP, status, boosts, calc) on both sides. This is the direct payoff of the omniscient choice: the `number_of_opponent_reserve_revealed` fog-of-war bookkeeping in the reference is deleted.

### 4d. Table invalidation
The precomputed base-roll table is valid only while base rolls hold. **Refresh/dirty-flag on events scalars can't reach:** form change, item consumed / knocked off / Tricked, ability change (e.g. Mummy, Trace), or move-type change. Boosts/screens/weather/burn stay as scalars — no refresh needed.

---

## 5. Locked summary

- Static, omniscient, zero-sum eval.
- Adopt Foul Play's per-mon + side-condition weights as the v1 baseline (§3).
- **Replace** the static matchup term with a precompute-base-rolls + scalar-modifier calc term, **two Tera slices per mon** (§4a–4b).
- Tera = live search decision + "held threat" scored state.
- Hazards × living-reserve-count: **keep** (it's the best heuristic in the reference).

---

## 6. Open / to-tune (flagged, not blocking the build)

These don't block writing the eval; they're tuning dials to set against usage-stat teams later.

1. **Weight of the calc matchup term** vs Foul Play's flat 20 — needs tuning, and remember it should taper as search depth rises.
2. **"Unused Tera" bonus** magnitude.
3. **Poison/Toxic as conditional** rather than flat: the newer Rust version made these context-dependent (a poison is worse early with a full bench, less relevant late — same shape as the hazard heuristic). Worth folding in.
4. **Explicit weather/terrain terms?** Reference scores them only implicitly (via damage). Decide whether standing weather/terrain deserves its own term.
5. **Speed in the eval:** reference scores speed only through boosts; the Rust changelog explicitly *removed* speed-based paralysis scoring. Decide whether a raw speed-tier advantage deserves a standalone term or stays purely in the calc/search.
6. **Boost DR curve, status/volatile magnitudes:** adopt as-is for v1; revisit only if tuning shows a problem.

---

## 7. Next components (not this doc)

- **Search spec** — expectiminimax for singles (depth, pruning switches, chance-node abstraction, simultaneous-move handling); MCTS design for VGC.
- **Calc-precompute module** — the per-battle base-roll table + Tera slices + scalar-modifier layer described in §4a.
- **Game-plan layer** — how the reused matchup math becomes human-readable threat/speed/KO reasoning.
