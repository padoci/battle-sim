# Battle AI — Project Brief & Build Plan (Claude Code handoff)

Read this first. It's the single entry point; the three specs below are the detail.

---

## 1. What we're building

A **client-side, in-browser** competitive Pokémon teambuilding tool for the Smogon/VGC crowd. Two modes, one engine:

- **Can you 6-0?** — a draft roguelike. Draft six mons from randomised, softened, usage-weighted offers (beginner: 10 options, pick species then a curated set; normal: 6 options, pick mon+set together), then watch an AI pilot them through a **six-battle gauntlet**, cinematically. Win all six = flawless.
- **Test your team** — paste a team, simulate it against a configurable field of real meta teams, and get a **matchup dashboard**: best/worst matchups rolled up from individual threats into archetypes, each with a game plan and the calc evidence, all exportable.

Both modes are **AI-vs-AI, auto-run**. The skill being tested is *teambuilding*, not piloting.

---

## 2. Hard constraints (hold these everywhere)

- **No server.** Fully client-side, static-hostable. Sims run in a **web worker** off the main thread.
- **v1 = Gen 9 OU singles.** VGC/doubles is v2 — don't over-fit singles-only assumptions (esp. in the search and eval).
- **Omniscient, symmetric AI.** Both teams fully known; the *same* search + eval drives both sides so weaknesses cancel and aggregate win-rates mean something.
- **Competitive-audience bar:** play must be *defensible* (not perfect); data surfaces must be **Showdown-fluent** (type colors, HP bars, sprites); always **show the working** (KO ranges, speed tiers).
- **Voice:** "direction, not gospel." Reads to pressure-test, never verdicts.

---

## 3. Tech stack

- `@pkmn/sim` — battle engine + team validation
- `@pkmn/dex` — species/move/item data
- `@smogon/calc` — damage (eval matchup term + game plans)
- `@pkmn/img` — sprites / icons / models
- `@pkmn/smogon` — sets / stats / teams from **data.pkmn.cc**
- Data endpoints (per format): `/sets/gen9ou.json` (draft pool + pickable sets), `/stats/gen9ou.json` (offer weighting, realism, archetype reads), `/teams/gen9ou.json` (opponents)
- On-device LLM (optional, progressive enhancement): Chrome Prompt API / Gemini Nano via `LanguageModel.availability()`
- Type: **Archivo** (display) / **IBM Plex Sans** (body) / **IBM Plex Mono** (all data)

---

## 4. The three specs (in-repo references)

| Spec | Governs |
|---|---|
| `eval-function-spec-v1.md` | **Scoring** — the static position evaluator (what a battle state is worth), adapted from Foul Play with a calc-driven, Tera-aware matchup term. |
| `search-spec-v1.md` | **Decision procedure** — how each turn's action is chosen; simultaneous-move handling; the shallow-expectiminimax v1 and its measured MCTS escalation path. |
| `ui-spec-v1.md` | **Product** — every screen, the draft flow, the dashboard, calibration/ETA, exports, analysis + archetype + game-plan generation, visual identity. |

---

## 5. Architecture at a glance

```
 data.pkmn.cc ──▶ Data layer (fetch + cache + resolve set "slashes")
                        │
                        ▼
        ┌───────────────────────────────────┐
        │  Engine substrate (worker)         │
        │  state · legal actions · transition│
        │  eval · calc-precompute            │
        └───────────────┬───────────────────┘
                        ▼
                 Search (shallow expectiminimax v1)
                        │
        ┌───────────────┴───────────────┐
        ▼                               ▼
  Test your team                  Can you 6-0?
  bulk sim → analysis →           draft → gauntlet →
  archetype → dashboard           cinematic battles →
  + game plans + export           run result + post-mortem
                        │
                        ▼
             UI (lab × arena; Showdown-fluent surfaces)
```

The eval, calc-precompute, and matchup analysis are **shared**: the same primitives that let the AI play also produce the game plans and the post-mortem. Build them once.

---

## 6. Staged build plan (do NOT one-shot this)

Each stage is its own scoped session. A stage marked **[human gate]** means *you* review before continuing — Claude Code can verify correctness but not the judgment the gate needs. **[CC]** means Claude Code's own tests/typecheck are sufficient to proceed.

**Stage 0 — Scaffold + data layer.** Project setup; fetch/cache `/sets`, `/stats`, `/teams` for gen9ou; resolve movesets (slashes) to concrete `PokemonSet`s.
→ **[CC + quick look]** You can pull the pool, a mon's sets, and sample teams and see them.

**Stage 1 — Engine substrate + eval + calc-precompute.** State model; legal actions from `@pkmn/sim`; transition via `@pkmn/sim`; implement the eval (eval spec); build the calc table (base rolls + two Tera slices + scalar modifiers).
→ **[CC]** Eval returns sane scores on hand-built states; calc table matches `@smogon/calc` spot-checks.

**Stage 2 — Search v1 + THE measurement gate.** Joint-action matrix builder; greedy d1 → pessimistic expectiminimax d2; switch pruning; chance abstraction; Tera-in-search; root matrix-equilibrium. Run headless AI-vs-AI.
→ **[human gate — the big one]** Measure **ms/turn** and **nodes/turn**. Watch a few battle logs. *Is the play defensible? Is it fast enough for N-battle test-your-team?* This is the go/no-go on the whole AI approach — decide here whether shallow expectiminimax ships or you escalate to MCTS (search spec §6). **Everything downstream rides on this; do not skip it.**

**Stage 3 — Test your team, end to end.** Opponent-pool config + per-team frequency; calibration (~10 battles) → ETA → choose N; fast worker run with live progress/ETA; aggregate analysis; rule-based archetype classifier; matchup dashboard; game-plan template spine + optional Nano polish; export (JSON + Markdown first).
→ **[human gate — taste]** Do the matchup reads and game plans feel useful and correct *to you as a player*?

**Stage 4 — Can you 6-0?, end to end.** Draft flow (beginner/normal, softened `usage^α` sampling, Species Clause); gauntlet; cinematic battle view (sprites, animated HP, generic attack/impact FX, floating damage, playback speed/skip); run result + reuse the analysis engine as post-mortem.
→ **[human gate — taste]** Does the draft feel good? Does the cinematic battle land?

**Stage 5 — Identity + quality floor.** Execute the visual direction (avoid the three AI-default looks — ui spec §2); responsive to mobile; keyboard focus; `prefers-reduced-motion`; VGC control present but disabled.

---

## 7. Two risks to hit early (don't let them surface late)

1. **Simultaneous-move correctness** (search spec §3). Naive minimax gives the bot phantom foresight; a competitive player will feel the resulting misplays. Root matrix-equilibrium + pessimistic interior is the v1 fix. Get it right in Stage 2, not later.
2. **Transition-function speed** (search spec §5). Searching through `@pkmn/sim` may be too slow for deep search — this is *why* poke-engine exists. Shallow v1 keeps it viable; the Stage-2 measurement is what tells you if you've hit the wall. If you have, escalate deliberately (MCTS + a fast transition model), don't paper over it.

---

## 8. How to run this with Claude Code

Stage it. Keep this file and the three specs in the repo so every session shares context. At each **[human gate]**, actually stop and look — especially Stage 2. Claude Code will test that what it built *works*; you're testing whether it's *good* and whether the approach *holds*. Those are different questions, and only the second one decides whether this becomes the tool you wanted.

Order is deliberate: the AI is proven (or escalated) on measurement before any mode's UI is built on top of it, so a wrong bet costs one stage, not the whole project.
