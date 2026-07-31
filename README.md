# Team Preview

A client-side, in-browser competitive Pokémon teambuilding tool for the Smogon/VGC crowd. Two AI-vs-AI game modes, one engine: the skill being tested is **teambuilding, not piloting**. Every read the app gives you is *direction, not gospel* — a pressure-test, never a verdict.

All simulation runs in a web worker in your browser: nothing you paste is uploaded, and there is no account. The one server-side piece is the feedback inbox (`functions/api/feedback.ts`), which receives a message only when someone writes one and presses send. Everything else is static.

**Live demo:** https://battle-sim-eo1.pages.dev (Cloudflare Pages, deployed from `main`).

> **Naming.** The product is **Team Preview**; the domain is `teampreview.gg`. Three
> things deliberately still say `battle-sim`, because they identify the repo or the
> host rather than the product, and changing them breaks something:
>
> | Still `battle-sim` | Why |
> |---|---|
> | `DEPLOY_BASE=/battle-sim/` in `deploy.yml` | Project Pages serve under `/<repo>/`. Follows the GitHub repo name, so it changes only if the repo is renamed. |
> | The `padoci/battle-sim` repo and its clone URLs | Renaming a repo rewrites every clone URL and the Cloudflare build hook. Worth doing deliberately, not as a side effect. |
> | `battle-sim-eo1.pages.dev` in `index.html` og tags | These are absolute URLs and must point at a host that resolves **today**. Switch them the moment `teampreview.gg` has DNS, not before, or every share unfurls to a dead link. |
>
> Switching to the new domain is then: the four absolute URLs in `index.html`
> (`og:url`, `og:image`, `twitter:image`, and the `preconnect`s if they change),
> the two live-demo links in this file, and a regenerated `og.png` carrying the new
> wordmark.

## Two modes

- **Can you 6-0?** — a draft roguelike. Draft six Pokémon from randomized, usage-weighted offers, then watch the AI pilot your team through a six-battle gauntlet, cinematically, styled like a classic handheld battle. Win all six to go flawless. Three modes, shown in the UI as **Gym Challenge**, **Normal** and **Hard** (`gymleader` / `easy` / `hard` in the code — `easy` is the one labelled "Normal"): Gym Challenge fields real gym leaders building to a champion finale, Normal starts against weak opponents and ramps up over the six battles, and Hard fields full-strength opponents from rung one. Post-mortem tells you what ended the run — with the calc to back it up.
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

Data comes from [data.pkmn.cc](https://data.pkmn.cc) per format: `/sets/gen9ou.json` (draft pool + pickable sets), `/stats/gen9ou.json` (usage weighting), `/teams/gen9ou.json` (opponent teams), cached client-side in IndexedDB with a ~24h TTL and a GitHub mirror fallback. The opponent pool is augmented with **vendored packs of real teams**, built and validated by `scripts/build-sample-teams.ts` and shipped statically — no runtime fetch, no CORS exposure: `src/data/vendored-teams.gen9ou.json` (29) and `src/data/mined-teams.gen9ou.json` (30). Merged with the teams fetched for the format, then deduped and re-validated, that currently lands at **62 teams in the field**.

## Getting started

```bash
npm install
npm run dev      # the app
npm test         # the vitest suite (200+ tests), fully offline
npm run build    # production build (the app only)
```

Pages:

- `/` — the app (both modes); the only thing a production build emits
- `/dev.html` — data/engine inspector (draft pool, resolved sets, opponent teams, live TeamValidator checks)
- `/measure.html?battles=N&config=fast|strong&seed=N` — search performance measurement in the real browser worker

`npm run dev` serves all three. **The two dev tools are deliberately excluded
from `npm run build`** — `measure.html` takes its battle count and config
straight from the query string and will run a visitor's CPU flat out for ~20
minutes, so it must not exist on the deployed site. `public/robots.txt` also
disallows both, but that only asks crawlers nicely; omitting them from the
build is what actually makes the URLs 404.

To build them anyway (which `scripts/measure-browser.mjs` needs, since it
drives the built artifact through `vite preview`):

```bash
BUILD_TOOLS=1 npm run build
```

Dev/tuning knobs on the gauntlet: `#/sixoh?seed=123&config=fast&tera=25` (reproducible run / d1 search / eval `TERA_AVAILABLE` override — for watching how Tera timing changes with the weight).

## Deploys & previews

- **Production** — Cloudflare Pages builds `main` automatically → https://battle-sim-eo1.pages.dev.
- **Per-PR previews** — Cloudflare Pages also builds every PR to its own throwaway URL (real network → real sprites, fully interactive), posted on the PR, so it can be checked with one click instead of pulling the branch.
- **GitHub Pages (retired)** — `deploy.yml` is `workflow_dispatch`-only: Pages was disabled on the repo when production moved to Cloudflare, which made every push-triggered deploy fail. To revive it, re-enable Pages (Settings → Pages → Source: "GitHub Actions") and dispatch the workflow; it sets `DEPLOY_BASE=/battle-sim/` for the repo-subpath.

The Vite `base` is environment-driven (`vite.config.ts`): it defaults to `/`, and only the GitHub Pages job sets `DEPLOY_BASE`. Cloudflare doesn't, so its builds serve correctly from the root — no per-host config. Routing is hash-based (`#/…`), so no SPA-fallback/redirects file is needed on either host.

One-time Cloudflare setup (dashboard → Workers & Pages → Create → Pages → Connect to Git):

- **Repository:** `padoci/battle-sim` (unchanged by the rename; see the Naming note at the top)
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- Node version comes from `.nvmrc` (22); nothing else to configure.

Cloudflare posts each preview URL back onto the PR as a deployment status once it's connected.

## Feedback inbox

"Get in touch" in the footer is an anonymous inbox. It posts to `/api/feedback`, a Cloudflare Pages Function (`functions/api/feedback.ts`) that relays the message to a Discord or Slack webhook. It runs on the site's own origin, so no third-party form service sees anything, and it forwards only the fields someone typed: topic, message, an optional free-text contact detail, and a browser string they can opt into for bug reports. It reads no IP, no user agent, and no `request.cf`, and stores nothing.

Setup is one secret:

1. Make an incoming webhook. Discord: channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL. Slack: an app with Incoming Webhooks enabled.
2. Cloudflare dashboard → the Pages project → Settings → Environment variables → add `FEEDBACK_WEBHOOK_URL` as a **secret** (encrypted), for Production and, if you want to test it there, Preview.
3. Redeploy. Pages Functions pick up new variables on the next build.

Without the secret the endpoint answers `503`, and the panel says so and offers the mailto route rather than accepting a message that nothing receives.

Plain `npm run dev` does not serve Functions, so the panel there will report the inbox as unavailable and fall back to email. To exercise the real thing:

```bash
npm run build
npx wrangler pages dev dist                       # 503 from /api/feedback: route resolved, no secret
npx wrangler pages dev dist --binding FEEDBACK_WEBHOOK_URL=http://localhost:9911/hook
curl -s -X POST localhost:8788/api/feedback -H 'content-type: application/json' \
  -d '{"topic":"feedback","message":"hi","contact":"","browser":"","confirm-empty":""}'
```

Point the binding at any local server that accepts a POST to see what would land in the channel. Worth running after touching `functions/`: the unit tests call the handler directly and so cannot catch a bundling or routing failure, and `npm run build` does not compile this directory.

Discord caps a webhook message at 2000 characters, so longer messages are split across several posts and marked `(1/2)`, `(2/2)`. Nothing is truncated.

**Spam.** The form has a honeypot field and per-field length caps, and a caught bot gets a silent `204` rather than a hint about which field it tripped. If that stops being enough, add a Cloudflare Rate Limiting rule on `/api/feedback` (dashboard → the domain → Security → WAF → Rate limiting rules) rather than tracking senders in the app, which would mean handling the IPs the endpoint currently refuses to look at.

**The privacy wording depends on this.** `PrivacyNote` used to say "no server"; this endpoint made that false, so the phrase came out and the narrower promise stayed. `test/app/privacy-note.test.ts` enforces the rest: exactly one file in `src/` may POST, it must target a relative path, and nothing under `functions/` may read an identifying header or hold a storage binding.

## Scripts

- `npx vite-node scripts/measure.ts` — Node-side search gate numbers (ms/turn, nodes/turn, strength vs baselines) + rendered battle logs into `logs/`
- `BUILD_TOOLS=1 npm run build && node scripts/measure-browser.mjs` — the same numbers in headless Chromium against the built artifact (the real gate numbers); needs the flag, see above
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
| 7 | Dev process: CI (tests/e2e/visual regression), per-PR previews, vendored team pool | ✅ PRs #12–#13 |
| 8 | Code-split landing (~9 MB → ~150 KB initial JS) | ✅ PR #14 |
| 9 | Polish (footer/attribution, W-L-D bars, a11y) · what-to-change suggestions · move-typed battle cinematics | ✅ PRs #15–#17 |

## Specs

The design lives in four documents at the repo root: `HANDOFF.md` (build plan), `eval-function-spec-v1.md` (position evaluation), `search-spec-v1.md` (decision procedure), `ui-spec-v1.md` (product).

## Data & licensing

Set, usage, and team data from [data.pkmn.cc](https://data.pkmn.cc) (Smogon community data); sprites served from Pokémon Showdown's CDN. This is a fan project with no affiliation to Nintendo, Game Freak, The Pokémon Company, or Smogon. No license file yet — that's the repo owner's call.
