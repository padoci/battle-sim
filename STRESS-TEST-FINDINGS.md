# Pre-launch stress test — findings

Harnesses were written first, run, and only then fixed against. Everything below
was **reproduced by a test**, not inferred from reading. Each finding says how
reachable it is in production today, because several are guards against futures
rather than bugs a visitor hits this week.

Three subsystems had **zero** test coverage before this: `src/worker/`,
`src/run/bulkRunner.ts`, and the analysis layer's degenerate-input behaviour.

---

## Fixed — genuinely user-facing

### 1. A broken cache reported a working network as a failed one
`src/data/fetch.ts`

`store.get` and `store.set` both sat inside the `try` whose `catch` rethrows
`all sources failed for ${key}`. The app's copy for that error says *"check your
connection and reload"*.

So: IndexedDB throws (Safari private browsing, a quota-full device — the stats
payload is ~3 MB), the 3 MB download having *just succeeded* is discarded, and
the user is told their connection is bad. The read side was worse: `store.get`
rejects **before any network attempt**, bricking the load on a perfect connection.

Fixed by making store I/O best-effort (`safeGet`/`safeSet`) and moving the cache
write outside the failing `try`. `all sources failed` now means only that.

**Reachability: high.** Safari private browsing is not exotic.

### 2. A 200 with the wrong body was cached as if it were good
`src/data/fetch.ts`, `src/data/client.ts`, `src/data/endpoints.ts`

`response.ok` + `JSON.parse` was the entire validation. A 200 carrying
wrong-shaped JSON — a mirror mid-rewrite, a captive portal, an error envelope —
counted as success, so the mirror was **never tried** and the garbage was cached
for a full 24 h TTL. Worst case is silent: `{}` for sets yields
`Object.entries({})`, i.e. an empty draft pool and *no error at all*.

Added an optional `validate` hook that throws inside the per-URL `try`, so
failover happens for free, plus a top-level shape assertion per resource. Also
added a `CACHE_SCHEMA` prefix to the cache key (kept separate from `resourceKey`,
which doubles as the URL path) so anyone already holding a poisoned entry is
orphaned onto a fresh fetch instead of waiting out the TTL.

### 3. `terminate()` stranded every in-flight promise
`src/worker/client.ts`

`terminate()` was one line: `worker.terminate()`. Any pending `run()` promise
then never settled — not resolved, not rejected. `resetSixOhSession()` calls
`terminate()` on **every "Draft again"**, so a restart mid-battle leaked a
promise and its `.catch(RUN_ERROR)` handler never fired.

### 4. No timeout of any kind on a sim run
`src/worker/client.ts`

`run()` settled only on `done`/`error`/worker-death. Both UI watchdogs
(`ConfigureRun.tsx`, `SixOhDraft.tsx`) guard *data loading* only — nothing
guarded the run. A wedged worker meant a spinner forever with no recovery but a
manual reload.

Added an **idle** deadline (default 120 s), reset on every `progress`/`chunk`,
not a wall-clock one — a legitimate STRONG batch legitimately takes minutes. Same
reasoning the stall-timeout in `fetch.ts` already documents.

### 5. `cancel()` silently missed older runs
`src/worker/client.ts`

`inFlightId` was a single value overwritten by every `run()`, so with two runs in
flight `cancel()` aborted only the newest and the older kept burning CPU. Now
aborts everything pending.

### 6. A stale lazy chunk after every redeploy
`src/app/preloadError.ts` (new), `src/main.tsx`, `src/app/ErrorBoundary.tsx`

Every screen but Landing is `lazy()`. A Cloudflare Pages redeploy replaces the
hashed chunk names, so anyone holding the previous `index.html` gets a 404 the
moment they navigate — surfacing as a raw
`Failed to fetch dynamically imported module: …` in the ErrorBoundary.

Added a `vite:preloadError` handler that reloads **at most once per tab** (an
unconditional reload boot-loops when the chunk is genuinely gone), with the
second occurrence falling through to real copy: *"A new version of the site was
deployed while this tab was open."*

**Reachability: certain.** It happens to every open tab on every deploy.

### 7. "Back to start" did nothing
`src/app/ErrorBoundary.tsx`

`reset()` set `location.hash = ''`. When the hash was *already* empty no
`hashchange` fired, `useRoute` never updated, and the same screen re-rendered
straight back into the same crash. Now navigates to `#/`.

---

## Fixed — found by the fuzzer, low reachability today

`test/replay/parse.fuzz.test.ts` mutates a real 589-line battle log (truncate at
a pipe, drop a field, corrupt a numeric, break a `|split|` pair) and asserts four
properties over 600 seeded mutants, plus every streaming prefix.

It found, and `src/replay/parse.ts` now guards:

| Site | Was |
|---|---|
| `-damage`, `-heal` | `parseHp(parts[3])` → `TypeError` on a truncated line |
| `-fieldstart/-fieldend` | `parts[2].replace(...)` on `undefined` |
| `-sidestart/-sideend` | `parts[3].replace(...)` on `undefined` |
| `-boost/-unboost` | `Number(parts[4])` → a silent `NaN` boost delta |
| `turn` | `Number(parts[2])` → `NaN` turn number |
| `move`, `-status`, `-curestatus`, `-terastallize`, `cant` | rendered the literal text `"used undefined!"`, `"is now undefined!"` etc. |

`parseHp` now returns `undefined` for an unparseable condition and callers drop
the event, rather than fabricating `0 HP` — which read as a **phantom faint** in
the replay.

**Reachability: low today, and worth saying so plainly.** This log is our own
`@pkmn/sim` output, not user input, and `chunk` messages carry complete lines
(`logLines: string[]`), so the streaming path can't split mid-line. Whole-line
prefixes already parsed cleanly before the fix. The value is forward-looking: a
`@pkmn/sim` minor bump changing a line's shape is exactly the sort of thing that
ships silently, and this parse runs on the **render path** — `SixOhGauntlet`
re-parses the whole accumulated log once per streamed decision, so a throw there
white-screens a live battle.

Belt-and-braces for that: the `useMemo` in `SixOhGauntlet.tsx` now catches and
degrades to the static result card instead of taking out the screen.

---

## Fixed — robustness, not a live bug

### 8. Bulk runs were not reproducible from their config
`src/run/bulkRunner.ts`

`battleSeed: randomSeed()` is `Math.random()`-derived, so a user reporting *"my
team went 12–88"* handed over a result nobody could replay. Battle seeds are now
derived from the run seed, and `BulkRunner.seed` exposes it.

---

## Checked and found healthy — no changes made

Worth recording, because "we looked and it was fine" is a result too:

- **The analysis layer (1,508 LOC across nine modules) is robust.** 30 degenerate
  cases — zero battles, one battle, all draws, all wins, all losses, nobody
  fainting, `winner: null` from the decision cap — produced no throws, no `NaN`,
  and no `undefined` leaking into user-visible prose. `wilsonHalfWidth` is finite
  and in `[0,1]` at n=0 and at extreme rates. `buildPostMortem` correctly says
  *"Stalled out"* rather than *"Eliminated"* for a capped battle.
- **A capped battle is counted as a draw, not a phantom loss** — verified, not
  assumed.
- **The streaming-prefix invariant held before any fix**: every decision-boundary
  prefix of a real log parsed cleanly.
- **No XSS sink anywhere in `src/`**: no `dangerouslySetInnerHTML`, no
  `innerHTML`, no `eval`, no `new Function`. All user-controlled strings render
  escaped through React.
- **The solver and seeding tests were already the strongest part of the repo**
  and are untouched.

---

## Deliberately NOT done

- **Global `window.onerror` / `unhandledrejection` handlers.** With no telemetry
  sink they can only render a message, and they'd double-report React's own
  re-thrown errors. The specific swallowed paths were fixed instead. Add them
  later *with* a sink, not before.
- **The worker protocol change for per-job error isolation.** Today one throw on
  job 24 of 25 discards the whole batch's accumulated results (mitigated in
  practice because `onProgress` already streamed each one into app state). It's a
  real wart, but it changes `protocol.ts` and wants its own review.
- **Extracting the duplicated paste validator.** `TeamImport.tsx:30-48` is
  duplicated near-verbatim at `ConfigureRun.tsx:221-234`, and the
  `ConfigureRun` copy is a bare IIFE rather than a `useMemo`, so it re-runs
  `TeamValidator.validateTeam` on **every render of that screen** — including
  every pool-weight slider drag. Worth doing; it's a refactor, not a bug fix.
- **`ensureFresh`'s positional forme-change re-keying** (`calc/table.ts:193-203`).
  Two forme changes on one side in a single transition mispair, producing a
  silently wrong damage table. Vanishingly rare in Gen 9 OU singles and it needs
  a constructed state to test.
- Any tuned search/eval constant.

---

## Publish-readiness checklist (not code — decisions for you)

- [ ] **LICENSE.** Still absent; `README.md:143` calls it your call, and it is.
      Blocking for "published for good" in the sense that the default is
      all-rights-reserved: legal to publish, but nobody can fork or contribute.
- [ ] **`dev.html` and `measure.html` ship to production** (`vite.config.ts:26-31`).
      `measure.html` will happily burn a visitor's CPU for ~20 minutes via
      `?battles=N&config=strong`. `public/robots.txt` already disallows both, but
      robots.txt is a request, not a control. Gate them behind a build flag.
- [ ] **Two dead bootstrap blocks in `ci.yml`** — the TCGdex art-map bootstrap
      and the baseline bootstrap can never fire again (`tcgArtMap.json` is
      populated, 7 baseline PNGs are committed). Removing them lets the `visual`
      job drop to `contents: read`.
- [ ] **No `og:` / `twitter:` cards** in `index.html`. Cheap, and this is a
      project people will link to.
- [ ] **TCGdex is fetched but not credited** in the footer, unlike data.pkmn.cc,
      @pkmn/Showdown and the sprite CDN.
- [ ] **44 tracked files under `logs/`** — decide whether they belong in a public
      repo.
- [ ] `measure-browser.mjs` is not wired into CI, so perf regressions are
      invisible. It needs 10–20 min, so a nightly workflow, not a per-PR gate.

## What cannot be verified locally

- The 5 `scripts/e2e-*.mjs` walkthroughs (real network for sprites) — CI only.
- The 7 visual baseline PNGs — the sandbox can't reach the sprite CDN, so local
  runs bake in blank sprites. CI `Update visual baselines` only.
- The actual `vite:preloadError` **trigger** needs a real redeploy against a
  Pages preview. The unit test covers the handler, not the trigger.
