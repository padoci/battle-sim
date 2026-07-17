# battle-sim

A client-side, in-browser competitive Pokémon teambuilding tool for the Smogon/VGC crowd. Two AI-vs-AI game modes, one engine: the skill being tested is **teambuilding, not piloting**. Every read the app gives you is *direction, not gospel* — a pressure-test, never a verdict.

No server. Fully static-hostable. All simulation runs in a web worker in your browser.

## Two modes

- **Can you 6-0?** — a draft roguelike. Draft six Pokémon from randomized, usage-weighted offers (beginner: pick species then set; normal: pick mon+set bundles), then watch the AI pilot your team through a six-battle gauntlet, cinematically. Win all six to go flawless. Post-mortem tells you what ended the run — with the calc to back it up.
- **Test your team** — paste a Showdown export, simulate it against a configurable field of real meta teams, and get a matchup dashboard: best/worst matchups rolled up into archetypes, individual threats with damage ranges, a game plan per matchup, all exportable as JSON or Markdown.

## How it works

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
                 Search (shallow expectiminimax)
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

Three design choices carry the whole thing:

- **Omniscient, symmetric AI.** Both teams are fully known and the *same* search + eval pilots both sides, so weaknesses cancel and aggregate win rates mean something.
- **Simultaneous moves handled properly.** Pokémon players lock in blind; naive minimax gives a bot phantom foresight. Each turn the search builds the joint-action payoff matrix and solves for a **mixed-strategy Nash equilibrium** at the root (the AI genuinely mixes and bluffs), with a pessimistic interior for depth-2.
- **The calc does the thinking everywhere.** The same precomputed damage table (with Tera slices) that powers the AI's evaluation also produces the dashboard's threat evidence, the game plans, and the gauntlet post-mortem. Prose only ever phrases computed facts.

## Stack

| Package | Role |
|---|---|
| [`@pkmn/sim`](https://github.com/pkmn/ps) | battle engine + team validation |
| [`@pkmn/dex`](https://github.com/pkmn/ps) / `@pkmn/data` | species/move/item data |
| [`@smogon/calc`](https://github.com/smogon/damage-calc) | damage calculation |
| [`@pkmn/img`](https://github.com/pkmn/ps) | sprites and icons |
| [`@pkmn/smogon`](https://github.com/pkmn/smogon) | wire types for data.pkmn.cc |
| React + Vite + TypeScript | app shell (hand-rolled hash router, no other runtime deps) |

Data comes from [data.pkmn.cc](https://data.pkmn.cc) per format: `/sets/gen9ou.json` (draft pool + pickable sets), `/stats/gen9ou.json` (usage weighting), `/teams/gen9ou.json` (opponent teams), cached client-side in IndexedDB with a ~24h TTL and a GitHub mirror fallback.

## Getting started

```bash
npm install
npm run dev      # the app
npm test         # ~180 vitest tests, fully offline
npm run build    # production build (three pages)
```

Pages:

- `/` — the app (both modes)
- `/dev.html` — data/engine inspector (draft pool, resolved sets, opponent teams, live TeamValidator checks)
- `/measure.html?battles=N&config=fast|strong&seed=N` — search performance measurement in the real browser worker

Dev/tuning knobs on the gauntlet: `#/sixoh?seed=123&config=fast&tera=25` (reproducible run / d1 search / eval `TERA_AVAILABLE` override — for watching how Tera timing changes with the weight).

## Scripts

- `npx vite-node scripts/measure.ts` — Node-side search gate numbers (ms/turn, nodes/turn, strength vs baselines) + rendered battle logs into `logs/`
- `node scripts/measure-browser.mjs` — the same numbers in headless Chromium against the production build (the real gate numbers)
- `node scripts/e2e-test-your-team.mjs` — full Playwright walkthrough of Test your team
- `node scripts/e2e-six-oh.mjs` — full Playwright walkthrough of Can you 6-0?

(The e2e/measure scripts expect Playwright; point `CHROMIUM_PATH` at a Chromium binary if it isn't auto-detected.)

## Status

Built in staged sessions, each ending in a reviewed PR (plan in `HANDOFF.md`):

| Stage | What | Status |
|---|---|---|
| 0 | Scaffold + data layer (fetch/cache/slash-resolution) | ✅ PR #1 |
| 1 | Engine substrate + eval + calc precompute | ✅ PR #2 |
| 2 | Search v1 + the measurement gate (browser: d1 ≈ 61 ms/turn, d2 ≈ 467 ms/turn) | ✅ PR #3 |
| 3 | Test your team, end to end | ✅ PR #4 |
| 4 | Can you 6-0?, end to end + this README | this PR |
| 5 | Visual identity + quality floor | next |

Current styling is deliberately functional only — the visual identity (the "lab × arena" design system in `ui-spec-v1.md` §2) lands in Stage 5.

## Specs

The design lives in four documents at the repo root: `HANDOFF.md` (build plan), `eval-function-spec-v1.md` (position evaluation), `search-spec-v1.md` (decision procedure), `ui-spec-v1.md` (product).

## Data & licensing

Set, usage, and team data from [data.pkmn.cc](https://data.pkmn.cc) (Smogon community data); sprites served from Pokémon Showdown's CDN. This is a fan project with no affiliation to Nintendo, Game Freak, The Pokémon Company, or Smogon. No license file yet — that's the repo owner's call.
