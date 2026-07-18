# battle-sim

A client-side, in-browser competitive Pokémon teambuilding tool for the Smogon/VGC crowd. Two AI-vs-AI game modes, one engine: the skill being tested is **teambuilding, not piloting**. Every read the app gives you is *direction, not gospel* — a pressure-test, never a verdict.

No server. Fully static-hostable. All simulation runs in a web worker in your browser.

**Live demo:** https://padoci.github.io/battle-sim/ (deployed from `main` via GitHub Pages).

## Two modes

- **Can you 6-0?** — a draft roguelike. Draft six Pokémon from randomized, usage-weighted offers (easy/normal: pick species then set; hard: pick mon+set bundles), then watch the AI pilot your team through a six-battle gauntlet, cinematically, styled like a classic handheld battle. Win all six to go flawless. Difficulty sets how hard the gauntlet fights back: **easy** starts against weak opponents and ramps up over the six battles, **normal** and **hard** field full-strength opponents throughout. Post-mortem tells you what ended the run — with the calc to back it up.
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

Data comes from [data.pkmn.cc](https://data.pkmn.cc) per format: `/sets/gen9ou.json` (draft pool + pickable sets), `/stats/gen9ou.json` (usage weighting), `/teams/gen9ou.json` (opponent teams), cached client-side in IndexedDB with a ~24h TTL and a GitHub mirror fallback. The opponent pool is augmented with a **vendored pack of real sample teams** (`src/data/vendored-teams.gen9ou.json`, built and validated by `scripts/build-sample-teams.ts`, shipped statically — no runtime fetch, no CORS exposure), currently 10 built-in + 8 vendored = 18 teams.

## Getting started

```bash
npm install
npm run dev      # the app
npm test         # the vitest suite (200+ tests), fully offline
npm run build    # production build (three pages)
```

Pages:

- `/` — the app (both modes)
- `/dev.html` — data/engine inspector (draft pool, resolved sets, opponent teams, live TeamValidator checks)
- `/measure.html?battles=N&config=fast|strong&seed=N` — search performance measurement in the real browser worker

Dev/tuning knobs on the gauntlet: `#/sixoh?seed=123&config=fast&tera=25` (reproducible run / d1 search / eval `TERA_AVAILABLE` override — for watching how Tera timing changes with the weight).

## Deploys & previews

- **Production** — `main` builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`), which sets `DEPLOY_BASE=/battle-sim/` so assets resolve under the repo subpath.
- **Per-PR previews** — Cloudflare Pages builds every PR to its own throwaway URL (real network → real sprites, fully interactive), so a PR can be checked with one click instead of pulling the branch. Production on GitHub Pages is untouched.

The Vite `base` is environment-driven (`vite.config.ts`): it defaults to `/`, and only the GitHub Pages job sets `DEPLOY_BASE`. Cloudflare doesn't, so its builds serve correctly from the root — no per-host config. Routing is hash-based (`#/…`), so no SPA-fallback/redirects file is needed on either host.

One-time Cloudflare setup (dashboard → Workers & Pages → Create → Pages → Connect to Git):

- **Repository:** `padoci/battle-sim`
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- Node version comes from `.nvmrc` (22); nothing else to configure.

Cloudflare posts each preview URL back onto the PR as a deployment status once it's connected.

## Scripts

- `npx vite-node scripts/measure.ts` — Node-side search gate numbers (ms/turn, nodes/turn, strength vs baselines) + rendered battle logs into `logs/`
- `node scripts/measure-browser.mjs` — the same numbers in headless Chromium against the production build (the real gate numbers)
- `node scripts/e2e-test-your-team.mjs` — full Playwright walkthrough of Test your team
- `node scripts/e2e-six-oh.mjs` — full Playwright walkthrough of Can you 6-0?
- `npm run test:visual` — visual-regression suite (`@playwright/test`, `test/visual/`)
- `npm run test:visual:update` — regenerate visual baselines (see below)

(The functional e2e/measure scripts use the raw `playwright` library; point `CHROMIUM_PATH` at a Chromium binary if it isn't auto-detected.)

## Visual regression

`test/visual/*.spec.ts` (the `@playwright/test` runner, config in `playwright.config.ts`) screenshots the key screens — landing, the validated team preview, the 6-0 draft board, and the retro battle stage — on desktop and mobile, and diffs each against a committed baseline. This turns "the layout still looks right" into a CI gate: a restyle regression, a broken sprite, or a shifted element fails the build.

Baselines (`test/visual/**/*.png`) **are committed but are generated in CI**, never locally: the dev sandbox can't reach the sprite CDN, so a locally-shot screenshot bakes in blank sprites and would never match the real render. The flow:

- **First run** — the CI "Visual regression" job sees no baselines, generates them in-environment, and commits them (`[skip ci]`). Nothing to do by hand.
- **Steady state** — every PR the job *compares* only; an unexpected diff fails and uploads a `playwright-report` artifact with the before/after/diff images.
- **Intentional visual change** — after a deliberate restyle, run the **"Update visual baselines"** workflow (`workflow_dispatch`) on your branch to re-shoot and commit the new look as the baseline.

Dynamic, RNG-driven regions (HP windows, the battle log) are masked, and the suite runs under `prefers-reduced-motion` with animations frozen, so frames are stable.

**Two CI-trigger quirks to know** (both hit in practice):

1. A commit pushed by a workflow's `GITHUB_TOKEN` (e.g. the baseline-regen bot commit) **never auto-triggers CI** — GitHub's recursion guard. If a bot commit becomes a PR head, dispatch the `CI` workflow on the branch by hand.
2. A push whose commit **modifies `.github/workflows/`** may not spawn a `pull_request` run either. Same fix: `workflow_dispatch` the `CI` workflow on the branch.

## Status

Built in staged sessions, each ending in a reviewed PR (plan in `HANDOFF.md`):

| Stage | What | Status |
|---|---|---|
| 0 | Scaffold + data layer (fetch/cache/slash-resolution) | ✅ PR #1 |
| 1 | Engine substrate + eval + calc precompute | ✅ PR #2 |
| 2 | Search v1 + the measurement gate (browser: d1 ≈ 61 ms/turn, d2 ≈ 467 ms/turn) | ✅ PR #3 |
| 3 | Test your team, end to end | ✅ PR #4 |
| 4 | Can you 6-0?, end to end | ✅ PR #5 |
| 5 | Visual identity ("lab × arena") + quality floor | ✅ PR #6 |
| 6 | Feedback rounds: difficulty ladder, retro battle stage, perf + UX fixes | ✅ PRs #7–#11 |
| 7 | Dev process: CI (tests/e2e/visual regression), per-PR previews, vendored 18-team pool | ✅ PRs #12–#13 |
| 8 | Code-split landing (~9 MB → ~150 KB initial JS) | ✅ PR #14 |
| 9 | Polish (footer/attribution, W-L-D bars, a11y) · what-to-change suggestions · move-typed battle cinematics | ✅ PRs #15–#17 |

## Specs

The design lives in four documents at the repo root: `HANDOFF.md` (build plan), `eval-function-spec-v1.md` (position evaluation), `search-spec-v1.md` (decision procedure), `ui-spec-v1.md` (product).

## Data & licensing

Set, usage, and team data from [data.pkmn.cc](https://data.pkmn.cc) (Smogon community data); sprites served from Pokémon Showdown's CDN. This is a fan project with no affiliation to Nintendo, Game Freak, The Pokémon Company, or Smogon. No license file yet — that's the repo owner's call.
