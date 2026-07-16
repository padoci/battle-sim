# Battle AI — Search Spec (v1)

**Status:** Draft for Claude Code handoff. Third of three specs; with `eval-function-spec-v1.md` (scoring) and `ui-spec-v1.md` (product) this completes the set.
**Scope:** Gen 9 OU singles for v1. VGC/doubles is §9 (v2).
**One-line:** the search is the decision procedure that picks each turn's action for *both* AIs, using the static eval as its leaf evaluator.

---

## 1. What the search is for (and the one fact that makes it easier)

Both battlers are AI. Nobody pilots. The search runs for **both sides** — which is a design invariant, not a convenience: because the same search+eval drives both players, its weaknesses are symmetric and cancel, so aggregate win-rates over N games stay meaningful even when any single game is imperfect.

The load-bearing simplifier is **omniscience**. Foul Play and every real-ladder bot fight under fog of war — they must guess the opponent's sets, spreads, and items, which forces belief-state tracking and set-sampling. We know both full teams. That deletes an entire hard subsystem: the search sees exact stats, items, abilities, and Tera types on both sides, so every transition and every calc is exact. Much of what makes competitive Pokémon search hard does not apply here.

---

## 2. The engine-agnostic substrate (build this first)

The search *algorithm* is a small, swappable layer. Underneath it sits substrate that every algorithm choice reuses — so build and validate this before committing to an algorithm:

- **State model** — the full battle state (both sides' mons, HP, boosts, status, volatiles, field, hazards, weather/terrain, Tera-used flags).
- **Legal-action generation** — the available moves + switches per side, taken from `@pkmn/sim`'s request object each turn.
- **Transition function** — apply a joint action (both sides' choices) → resulting state(s). See §5 for the performance crux here; it's the biggest risk in the whole AI.
- **Eval** — the static leaf evaluator (`eval-function-spec-v1.md`).
- **Calc-precompute** — the per-battle base-roll table + Tera slices + scalar modifiers (`eval-function-spec-v1.md` §4a / §7). The search reads this; it does not re-run the calc pipeline per node.
- **Joint-action matrix builder** — given a state, produce the payoff matrix over (my action × opponent action) whose entries are state values. This is what §3 needs and it's algorithm-agnostic.

---

## 3. The simultaneous-move problem (the #1 correctness point)

Pokémon is a **simultaneous-move** game: both players lock in blind. Naive minimax/expectiminimax picks your action assuming the opponent then responds *knowing it* — handing your bot phantom foresight, as if it moved second with information. Foul Play hit exactly this and it's a stated reason they moved off plain expectiminimax. For a competitive audience it's not academic: a clairvoyant bot over-values risky lines it thinks it can react to, and mis-scores the very matchups this tool reports.

Three ways to handle it, in increasing correctness/cost:

1. **Pessimistic (safe floor).** For each of your candidate actions, assume the opponent replies with whatever is worst for you; pick the best worst-case. Sound, never assumes foresight, trivial to implement (min over the opponent axis of the joint matrix). Downside: over-cautious, never bluffs.
2. **Root matrix-game equilibrium (target).** At the decision point, build the joint-action payoff matrix (entries = state values from deeper search/eval) and solve for its **mixed-strategy Nash equilibrium**, then sample your action from it. Game-theoretically correct for simultaneous moves; it's what strong Showdown bots do (Foul Play emits exactly this per-turn matrix + chosen action + evaluation). Matrices are small in singles, so the solve is cheap.
3. **Decoupled selection inside MCTS** (regret-matching / decoupled UCB at simultaneous nodes) — the §6 escalation path handles simultaneity natively as it converges.

**v1 rule:** pessimistic in interior nodes, **matrix-equilibrium at the root**. You get proper mixed strategies where they matter most (the actual decision) at negligible cost, without paying the solve at every interior node.

---

## 4. v1 engine: shallow, pruned expectiminimax

For an in-browser, omniscient, v1 singles bot, a **depth-limited expectiminimax** with the pieces below clears the bar. It is simple, debuggable, deterministic enough to explain (which the game-plan feature reuses), and — done correctly — plays real Pokémon: switch-aware, hazard-aware, KO-seeking (the last falls out of the eval's alive/dead cliff).

- **Depth ladder.** Start at **depth 1** (greedy but switch-aware — already far past Showdown's random bot), then extend to **depth 2**, the level where proactive switching and setup-respect emerge. Deeper only if §5 allows.
- **Switch pruning.** Do not expand all five switches every node. Only consider switches that beat staying in (better matchup / avoids a KO). This is what keeps the branching from exploding.
- **Chance-node abstraction.** Do **not** expand all 16 damage rolls × secondary effects × crit branches — the tree explodes for nothing. Collapse to **expected damage / KO probability**, with at most a coarse high/low split near KO thresholds where the variance actually changes the decision.
- **Tera in search.** Tera is a once-per-battle decision the search owns (`eval-function-spec-v1.md` §4b). Add "move + Tera" as a small number of extra root actions using the precomputed Tera damage slice; don't blindly double every action at every node. An unused Tera is scored as a held threat by the eval.

**Why shallow is enough for v1.** The bar (from the product decisions) is *defensible*, not *perfect* — "direction, not gospel." Shallow-but-correct search (simultaneity handled, switches pruned, strong eval) is defensible, symmetric, and washed over N games into trustworthy matchup *signal*. It is the simplest thing that meets the bar, and it keeps our eval and calc reuse intact.

---

## 5. The performance crux: transition-function speed

**This is the biggest risk in the AI, so decide it consciously.** The reason poke-engine (Foul Play's Rust engine) exists at all is that searching *through Pokémon Showdown's simulator* is too slow — it's accurate but heavy, and deep search calls the transition function enormous numbers of times.

The key coupling: **algorithm depth ↔ transition-model speed.**
- **Shallow expectiminimax** (a few hundred node evals/turn) → running `@pkmn/sim` as the in-search transition is **plausibly viable**, especially with omniscience and hard switch-pruning. This is the v1 path: accurate transitions, no second engine to build.
- **Deep MCTS** (thousands of playouts/turn) → `@pkmn/sim` in-search will **not** keep up in-browser; you need a fast transition model.

**v1 decision:** search through `@pkmn/sim`, keep depth shallow, and **measure** (ms/turn and nodes/turn) against the two workloads — test-your-team wants many fast battles, "6-0" is a handful of battles that can afford to think harder. If measurement clears the bar, you're done. If not, escalate (§6).

---

## 6. Strength ceiling & upgrade path (only if measurement demands it)

If shallow expectiminimax under-performs the competitive bar, the proven next rung is **MCTS guided by the static eval** (not by random rollouts) — Foul Play's current design, and the approach that best fits a simultaneous-move game because it searches promising lines deep and weak ones shallow, and time-budgets cleanly (run for X ms → natural quality dial). It requires the fast transition model §5 flagged, via one of:

- **A lightweight JS transition model** — a stripped Gen 9 mechanics engine for search only (poke-engine's role, in JS), with `@pkmn/sim` retained as ground truth for the *displayed* battle. Most control, keeps our eval, biggest build.
- **WASM-compiled poke-engine** — it's Rust; it already bundles a fast engine + MCTS for singles. Least search work, but adds a Rust/WASM toolchain and its own eval (you'd patch it toward our spec), and it's singles-only.

Don't pre-build either. They're speculative until §5's measurement says the shallow path misses.

> Honest note on the arc: an earlier draft of this plan said "expectiminimax for singles, MCTS for VGC" purely on branching factor. Studying Foul Play added two truths — the simultaneous-move problem is real, and deep expectiminimax hits a depth wall — which is why §3 is non-negotiable and MCTS is named as the ceiling. But omniscience + in-browser + a v1 defensibility bar still make **shallow, correct expectiminimax the right first build**, with MCTS as a measured escalation rather than the starting point.

---

## 7. Time budgeting = the quality dial

Expose search effort as a budget (depth for expectiminimax, time/iterations for MCTS). Set it **per mode**: "6-0" runs few battles and can spend more per turn (cinematic, the user's watching); test-your-team runs N battles and needs speed, so a lower budget — the calibration/ETA in `ui-spec-v1.md` §5 is measuring exactly this cost. Same knob the earlier "N × depth × workers" quality dial referred to.

---

## 8. Invariants

- **Symmetry:** identical search + eval on both sides. Never handicap one side; difficulty (where it exists) comes from the draft/opponent selection, not from a weakened AI.
- **Determinism seam:** keep RNG (damage rolls, etc.) injectable so battles are reproducible for debugging and so the cinematic replay and the analysis agree.

---

## 9. VGC / doubles (v2 — scope, not spec)

Doubles is a different search, flagged so nothing in v1 gets over-fit to singles:
- **Action space explodes** — two active mons each choosing move **and** target, plus switches; the joint turn is tens of thousands of combinations. Minimax doesn't scale; **MCTS is mandatory**.
- **Prune the action space before search** — spread moves auto-resolve, single-target moves aim at the obvious threats; don't enumerate every legal target.
- **Model Protect explicitly** — something Protects on roughly half of all turns.
- **Bring-4 + lead selection** — a separate simulate-and-score loop before the battle, arguably more of the VGC skill than the in-battle play.
- **Eval needs a doubles pass** — positioning, spread damage, partner synergy, redirection; the singles eval's Tera slices also collide with target selection here.

---

## 10. Build order for Claude Code

1. **Substrate** (§2): state model, legal actions from `@pkmn/sim`, transition via `@pkmn/sim`, wire in eval + calc-precompute.
2. **Joint-action matrix builder** (§2/§3).
3. **v1 search** (§4): greedy d1 → pessimistic expectiminimax d2, switch pruning, chance abstraction, Tera-in-search, **root matrix-equilibrium** (§3).
4. **Budget + symmetry wiring** (§7/§8), per-mode budgets.
5. **Measure** (§5): ms/turn, nodes/turn, and strength vs a random-move baseline + self-play sanity. Decide whether to escalate.
6. *(If needed)* **MCTS + fast transition model** (§6).
7. *(v2)* **Doubles** (§9).

---

## 11. Open / to-tune

1. **Depth-2 vs depth-1 as the shipped default** — settle by §5 measurement, not upfront.
2. **Interior pessimism vs deeper matrix solves** — how far down the tree to pay for equilibrium vs pessimistic; root-only is the v1 stance.
3. **Per-mode budget values** — the actual depth/time numbers, set from calibration.
4. **Escalation trigger** — define the concrete strength/speed threshold at which you commit to MCTS, so it's a measured decision not a vibe.
