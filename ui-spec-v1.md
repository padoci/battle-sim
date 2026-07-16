# Battle AI — UI Spec (v1)

**Status:** Draft for Claude Code handoff.
**Companion docs:** `eval-function-spec-v1.md` (the AI's scoring), plus a search-spec still to be written (the AI's decision procedure).
**Platform:** Client-side single-page web app. No server. Static-hostable. All compute in-browser; sims run in a **web worker** off the main thread.
**v1 scope:** Gen 9 OU only. VGC is tier two (control present but disabled / "coming soon").

---

## 1. The shape of the app

Two modes, **one pipeline**: pick tier → get team(s) → simulate → present. Only two things differ between modes — where the team comes from, and how results render.

```
                 ┌─────────────┐
                 │  Landing /  │   tier control lives in the header (ambient, not a screen)
                 │ mode select │
                 └──────┬──────┘
          ┌─────────────┴─────────────┐
   "Test your team"              "Can you 6-0?"
          │                            │
   ┌──────▼──────┐             ┌───────▼───────┐
   │ Paste team  │             │  Draft (6x)   │  ← signature flow
   │  + validate │             │ beginner/normal│
   └──────┬──────┘             └───────┬───────┘
   ┌──────▼──────┐             ┌───────▼───────┐
   │ Configure + │             │  Cinematic    │
   │ calib + run │             │  gauntlet     │
   └──────┬──────┘             │ (6 battles)   │
   ┌──────▼──────┐             └───────┬───────┘
   │  Matchup    │             ┌───────▼───────┐
   │  dashboard  │             │  Run result   │
   └─────────────┘             │ + post-mortem │
                               └───────────────┘
```

Tier selection is a **persistent segmented control in the header** (Gen 9 OU / VGC), not a blocking screen — it's a small choice and shouldn't cost a click-through. In v1 VGC is visibly present but disabled.

---

## 2. Visual identity

The audience lives in Pokémon Showdown, so **functional Showdown fluency is a requirement, not a default**: in any data or battle surface, type colors, HP bars, and sprites must read instantly the way that crowd already expects. That familiarity is load-bearing and the brief pins it down. Everything *around* those surfaces — navigation, the draft, results — is where we build a distinct identity rather than aping Showdown's utilitarian chrome.

**Thesis: "lab × arena."** Two surface families. A light **Lab** (analysis, drafting, config — precise, calm, data-dense) and a dark **Arena** (cinematic battles, gauntlet — high-stakes, focused). The split is true to the subject: you *study* in the lab and *compete* in the arena.

### Token system (starter — Claude Code to execute and visually refine)

**Palette.** Type colors are the *functional accent system* — they encode meaning (a Fire move is red because it's Fire), so they're never decorative. One brand signal sits on top for primary actions.

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#0F1216` | Primary text; Arena base |
| `--paper` | `#F3F5F7` | Lab surface (cool off-white — deliberately **not** cream `#F4F1EA`) |
| `--arena` | `#191D26` | Battle / gauntlet surface |
| `--line` | `#D2D7DE` | Hairlines, dividers |
| `--muted` | `#6B7280` | Secondary text, captions |
| `--signal` | `#5B34D6` | Brand accent / primary actions (deep electric violet — owned space; Showdown is blue/red) |
| type colors | the 18 | Functional accents (HP bars, move tags, type badges) — from a standard type-color map |

**Type.**
- Display: **Archivo** (Expanded weight for the hero) — athletic, modern, confident; not the generic high-contrast serif.
- Body: **IBM Plex Sans** — clean, technical, neutral.
- Data: **IBM Plex Mono** — every number lives here (damage %, EVs, usage %, speed tiers, the `6–0` record). A tuned mono face signals "precision instrument," which is what this is.

**Signature element:** the **draft hand** — picks presented as a selectable hand of cards (10 beginner / 6 normal), each carrying sprite, types, and set. It's the memorable moment and it's pure subject-matter. Secondary signature: the **gauntlet ladder** — six rungs that fill as the run advances.

**Motion:** card hover/commit micro-interactions in the draft; a ladder-reveal on entering the gauntlet; the battle FX in §6. Respect `prefers-reduced-motion` throughout.

**Deliberately avoided** (so the build doesn't drift into them): cream/serif/terracotta; near-black + single acid accent; broadsheet hairline columns. The dark surface here is a considered slate carrying the *type-color* system, not a black canvas with one neon.

---

## 3. Screen — Landing / mode select

Hero states the thesis in one confident line, then two entry cards. Copy is end-user voice, active, specific:

- **Can you 6-0?** — "Draft a team from random picks, then send it through a six-battle gauntlet. Win all six to go flawless."
- **Test your team** — "Paste a team and see its best and worst matchups — with a game plan for each."

Header carries the tier control (OU active, VGC disabled) and persists across the app.

---

## 4. Screen — Team setup

### 4a. Test your team — paste import
- Large textarea accepting standard Showdown export format.
- **Live validation** via `@pkmn/sim`'s TeamValidator against the active format. Errors inline, in interface voice, specific about what and how to fix: "Great Tusk isn't legal in Gen 9 OU," "This set lists 5 moves — remove one." Never vague, never apologetic.
- Parsed **team-preview row**: 6 sprites + type badges so the user sees it registered correctly before committing.
- Primary action: **Analyze team**.

### 4b. Can you 6-0? — the draft (signature flow)
Difficulty toggle first, explained in-line:
- **Beginner** — 10 options per pick; choose the *species*, then choose from its curated sets.
- **Normal** — 6 options per pick; choose *mon and set together*, committing to the whole package.

Then **6 draft rounds**. Offers are sampled from the pool (mons that have a dex set in the tier) and exclude already-drafted species (Species Clause). Sampling is **usage-weighted but softened for variety**: draw proportional to `usage^α` with a tunable `α ≈ 0.5` (α = 1 is raw usage and hands you the same S-tier faces every run; α → 0 approaches uniform), plus a small probability floor so semi-viable-but-rare mons still surface. One knob (`α`) trades meta-realism against run-to-run variety.

```
BEGINNER round                          NORMAL round
┌────────────────────────────┐          ┌────────────────────────────┐
│  Pick 3 of 6                │          │  Pick 3 of 6                │
│                            │          │                            │
│ [mon][mon][mon][mon][mon]  │  10 mons │ [mon+set][mon+set][mon+set] │  6 bundles
│ [mon][mon][mon][mon][mon]  │  species │ [mon+set][mon+set][mon+set] │  full package
│         only               │          │  moves/item/spread shown    │
│                            │          │                            │
│  → then: choose a set       │          │  team tray: ▣▣▣□□□          │
│    [Swords Dance][Band]...  │          └────────────────────────────┘
│  team tray: ▣▣▣□□□          │
└────────────────────────────┘
```

- **Beginner two-stage:** select a species card → a set-picker reveals that mon's named dex sets ("Swords Dance," "Choice Band") with moves/item/spread shown → pick one → slot fills.
- **Normal one-stage:** each of the 6 cards is a concrete (mon + named set) bundle with everything visible → pick → slot fills.
- A **6-slot team tray** fills as you draft; the gauntlet ladder previews below.
- After the 6th pick: team preview → **Start the gauntlet**.
- **No reroll in v1** (offers are fixed per run — part of the challenge). Reroll is a v2 idea.

---

## 5. Screen — Configure & run (Test your team only)

"Can you 6-0?" has no bulk-run screen — its "run" *is* the cinematic gauntlet in §6. This screen is test-your-team's, and it has three stages.

### 5a. Configure the opponent pool
The opponent field is drawn from `/teams`, but the user controls it:
- **View the pool** — the sampled meta teams as a browsable list (each shows its 6 mons + its detected archetype from §6c).
- **Add / remove teams** — drop teams that aren't relevant to what they're testing, add more.
- **Per-team frequency** — a weight per team for how often it's fought, so a user pressure-testing one bad matchup can over-sample it.

### 5b. Calibrate, then choose N
- Run a fixed **calibration batch (~10 battles)** immediately, silently measuring this device's per-battle wall-clock time (it varies wildly by machine and by team complexity, so measure rather than guess).
- Use that to **project an ETA curve**: the user picks **N battles** with a live "≈ X min" estimate that updates as they drag N or reweight the pool.
- The 10 calibration battles count toward the total — they're not thrown away.

### 5c. Run
- Battles run **as fast as possible** in the worker (no animation — this is bulk sim, not the cinematic path).
- Keep the user informed: **live progress** (completed / N), a **running ETA** that re-estimates from actual throughput, and current partial results so the dashboard fills in progressively rather than blocking to the end.
- Cancellable; partial results are still analyzable.

Guidance: N is the user's stability/patience trade-off. ~10 is a quick gut-check; a few hundred makes the aggregate win-rates trustworthy. The calibration ETA is what lets them make that call with eyes open.

---

## 6. Screen — Results

### 6a. Can you 6-0? — cinematic gauntlet
Dark **Arena** surface. Six battles play **sequentially**; a loss ends the run.

Battle view contains:
- Two team-preview rows (yours vs opponent), active mons as sprites (`@pkmn/img`).
- HP bars: type-colored, animated drain. Status icons. Field / weather / hazard indicators.
- A paced **battle log** (Showdown-style cadence).
- Floating **damage numbers**; a generic **attack lunge + impact flash**. *(This is the pragmatic reading of "full cinematic": real sprites + animated HP + generic FX + damage numbers. No bespoke per-move animation library — that's a v2 rabbit hole.)*
- **Playback controls:** speed (1× / 2× / instant) and skip-to-result. A full battle is long; let the user control pace.

Between battles the **gauntlet ladder** advances and the running record shows (`3–0`).

Run end:
- **6–0** → flawless outcome screen.
- **Eliminated in game k** → record shown (`4–2` style).
- **Post-mortem** (reuses the matchup engine): one or two crisp reads on what ended the run — "Nothing on your team switches into Gholdengo." Expandable for the calc evidence.
- Actions: **Draft again** / **Try Normal**.

### 6b. Test your team — matchup dashboard
Aggregate of the bulk sim. Voice is **"direction, not gospel"** — a read to pressure-test, never a verdict.

```
┌─────────────────────────────────────────────┐
│  HEADLINE VERDICT                            │
│  "Solid, but leans fragile to speed control" │
│  overall win band ·  data in mono            │
├──────────────────────┬──────────────────────┤
│  WORST MATCHUPS       │  BEST MATCHUPS        │
│  ▸ vs Rain    32%     │  ▸ vs Balance  71%    │
│    └ Barraskewda      │  ▸ vs Stall    68%    │
│      outspeeds all 6  │                       │
│    └ Floatzel 2HKOs.. │                       │
│  ▸ vs Kingambit 39%   │                       │
└──────────────────────┴──────────────────────┘
        each card → expands to a GAME PLAN
```

- **Both granularities, rolled up** (per the design decision): archetype-level cards ("vs Rain — 32% over N games") that expand into the **individual threats** driving them ("Barraskewda outspeeds your whole team; Floatzel 2HKOs your pivot"), with the **evidence surfaced** — damage rolls, speed-tier comparisons, KO ranges, all in the mono face, because this audience checks the working.
- Each matchup expands to a **game plan** (see §6c): lead, win condition, what to preserve, what clock you're on. Rough and directional, not prescriptive.
- **Export findings** — the whole analysis is exportable: a structured **JSON** (raw win-rates, per-matchup threat lists, calc evidence — for the user's own tooling) and a **shareable report** (Markdown, and/or a rendered PNG/PDF of the dashboard) they can post or keep. Export reflects the current N and pool.
- Actions: tweak team / re-run / switch mode.

### 6c. How the analysis, archetypes, and game plans are produced

**Aggregate analysis (deterministic — always runs).** Don't narrate one replay; mine the whole batch of N games against each opponent for *recurring patterns*. Per matchup, compute: win-rate, which of your mons faint earliest and to what, which opposing mon does the most work, whether you typically lose the speed race, and which of your mons the sim leans on to win. Cross-reference with `@smogon/calc` for the *why* (the KO ranges and speed tiers behind the pattern). This is the reliable, offline spine — the "what did / didn't work" is a statistical read over the batch plus the calc, not a vibe.

**Archetype classifier (rule-based over features — no ML, no training data).** Classify each `/teams` opponent by computing a few features from its six sets and applying a small decision tree:
- **Weather/terrain setter present?** → the strongest signal. Rain setter + swimmers → *Rain*; sand setter → *Sand*; etc.
- **Count of offensive mons** (max-speed spreads, offensive natures, Choice/Booster items, setup moves) → high → *Hyper Offense*.
- **Count of defensive mons** (bulky spreads, recovery, hazards + phazing) → high → *Stall*; mixed → *Balance*.
- Output the **dominant** bucket, with *Balance* as the default catch-all and an optional secondary tag for hybrids ("Rain HO"). Transparent and tunable, so a competitive user can sanity-check why a team was labelled. Buckets are defined per-tier.

**Game-plan prose (progressive enhancement — the key insight: calc does the thinking, the LLM only does the talking).** The hard reasoning is *already computed* above; the plan is selection + ordering + phrasing of verified facts. So:
- **Spine (always):** a **template renderer** turns the structured facts into readable text ("Lead {X} to pressure {Y}; preserve {Z} as your check to {threat}; you're on a clock vs their {weather}"). Works everywhere, offline, free, deterministic — and can never state a *wrong* fact, because it only renders computed ones.
- **Polish (if available):** if the browser exposes an on-device model, hand it the *same structured facts* and ask it to rewrite them as fluent prose. This is squarely what small local models are good at (rewriting/summarizing) and pointedly *not* what they're bad at (reasoning) — so a weak model can't fabricate bad Pokémon advice; it's only rephrasing verified inputs. See §6d.
- **Optional BYOK:** a user who pastes their own API key can route the polish to a frontier model for richer prose. Never embed our own key in client-side code (it would leak); BYOK is the only safe cloud path for a server-less app.

### 6d. On-device LLM path (as of mid-2026)

Chrome shipped the **Prompt API** with the built-in **Gemini Nano** model as a stable feature in Chrome 148, running local inference on-device with no server, no API key, and no per-call cost; full promotion out of origin trial is expected around Chrome 150 (late 2026). The model (~multi-GB) is downloaded by Chrome itself on first use, and the API exposes `LanguageModel.availability()` (returns `available` / `downloadable` / `downloading` / `unavailable`) plus `LanguageModel.create()` / `session.prompt()` with structured (JSON-schema) output. Typings via `@types/dom-chromium-ai`.

Two hard caveats that make "spine + optional polish" the right architecture, not "LLM-first":
- **Chrome-desktop only.** WebKit/Safari has no support and Firefox is uncommitted, so a large slice of users won't have it. The deterministic template spine is therefore the *default*, not the fallback.
- **Small-model quality.** Gemini Nano is tuned for summarizing/rewriting, not for reasoning or precise factual work — which is exactly why we only ever ask it to phrase pre-computed facts.

Feature-detect with `availability()`; offer LLM-polished plans only when it returns `available`, otherwise render the template silently. (Alternative on-device routes — WebLLM / transformers.js over WebGPU — give cross-browser reach but ship a big model you host and manage; out of scope for v1, worth noting for later.)

---

## 7. Data layer (build recap)

Fetch per active format from **data.pkmn.cc** (via `@pkmn/smogon` or direct), cache client-side with the ~24h refresh in mind (IndexedDB or localStorage — these are fine here; this is a real deploy, not a claude.ai artifact):

| Endpoint | Feeds |
|---|---|
| `/sets/gen9ou.json` | Draft pool (= species with a dex set) + every pickable set |
| `/stats/gen9ou.json` | Draft-offer weighting, set-frequency realism, archetype reads |
| `/teams/gen9ou.json` | Gauntlet opponents + the test-your-team opponent field |

Set data arrives as movesets that may carry alternative moves/items ("slashes"); resolve to a concrete `PokemonSet` when building for the sim.

### Package roles
- `@pkmn/sim` — battle engine + team validation
- `@pkmn/dex` — species/move/item data
- `@smogon/calc` — damage (powers the eval's matchup term and the game plans)
- `@pkmn/img` — sprites / icons / models
- `@pkmn/smogon` — sets / stats / teams from data.pkmn.cc

---

## 8. State & navigation

Single-page view-state machine: `Landing → Setup(mode) → [Run] → Results`, with back-navigation preserved and tier + mode held in app state. A light hash router is enough; no framework router required. Cache fetched data across sessions; optionally persist an in-progress draft locally.

Quality floor (non-negotiable, per design guidance): responsive to mobile, visible keyboard focus, reduced-motion respected, empty/error states that give direction rather than mood.

---

## 9. Resolved since first draft

- **Field size / N** — no longer a fixed guess; the user chooses N against a measured ETA (§5b). The pool is user-editable with per-team frequency (§5a).
- **Archetype mapping** — rule-based feature classifier, *Balance* as default (§6c).
- **Game-plan generation** — deterministic template spine + optional on-device-LLM polish + optional BYOK (§6c–6d).
- **Draft variety** — usage-weighted sampling softened by `usage^α`, `α ≈ 0.5`, with a floor (§4b).

### Still genuinely open (tunables, not blockers)
1. **`α` value** for draft softening — start 0.5, tune by feel for how much variety vs. meta-realism.
2. **Archetype bucket list + thresholds per tier** — the exact set of buckets and the feature cutoffs need one pass of hand-tuning against real teams.
3. **Export formats** — confirm which of JSON / Markdown / PNG / PDF ship in v1 (JSON + Markdown is the low-effort, high-value pair).
4. **BYOK** — whether to include the bring-your-own-key polish path in v1 or defer.

---

## 10. v1 boundaries

In: Gen 9 OU, singles, expectiminimax AI (per eval spec + forthcoming search spec), both modes, pragmatic full-cinematic battles, client-side only.

Out (v2+): VGC / doubles, bespoke per-move animations, draft reroll, accounts, anything multiplayer.

---

## 11. Remaining gap before handoff

This spec defines the *body*. The **search spec** (expectiminimax depth, switch pruning, chance-node abstraction, simultaneous-move handling; MCTS for VGC later) is the *brain*, and it's still unwritten. The eval spec (§scoring) plus this UI spec plus that search spec together become the complete Claude Code prompt. Write the search spec next.
