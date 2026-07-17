# Tera timing — research notes & proposed eval redesign

Background for a future change to how the AI decides *when* to Terastallize.
Measured today: the AI Teras in ~100% of battles at mean turn ~4 (~14% into the
game) — far too eagerly. Cause: the eval gives a flat `TERA_AVAILABLE = +10`
bonus for holding Tera and otherwise scores Tera only by its immediate effect
on the calc table, so it cashes Tera the moment any attack's immediate value
clears +10. We want it to hold Tera for genuinely high-value moments.

## Part 1 — What the research established (verified prior art)

Deep-research pass (fan-out search → fetch → 3-vote adversarial verification).
The **prior-art / computability** half verified cleanly; the **competitive-theory**
half did not (see the gap note below).

- **No leading Pokémon AI models Tera as an option-valued, one-time
  irreversible resource.** All three reference systems fold the Tera decision
  into the general per-turn action space and let search / a learned policy find
  the timing implicitly:
  - **Foul Play** (pmariglia) — root-parallelised MCTS (DUCT for simultaneous
    moves) over poke-engine; Tera is a searchable `ToggleTerastallized`
    state/action with *no* bespoke timing heuristic.
    <https://pmariglia.github.io/posts/foul-play/>
  - **PokéChamp** (ICML 2025) — LLM-augmented minimax; Tera is one action
    evaluated through a Tera-aware damage calc, with a heuristic positional leaf
    eval and *no* option-value term (their leaf eval is the direct analog of our
    flat +10). <https://arxiv.org/abs/2503.04094>
  - **VGC-Bench** (AAMAS 2026) — Tera is a boolean flag in a flat 107-action
    space; timing learned end-to-end via RL/BC/EGTA.
    <https://arxiv.org/html/2506.10326v3>
  → An **explicit option-value Tera term in an omniscient search engine is
  novel** relative to the published state of the art.

- **Transferable engineering technique — faint-grouped damage branching.** Foul
  Play collapses the 16 damage rolls into branches grouped by *whether the move
  causes a faint*, because "does this KO" is the decision-relevant property.
  This is exactly the signal a Tera-timing eval should key on: **a high-value
  Tera flips a KO branch** (turns a non-KO roll into a guaranteed KO, or an
  incoming OHKO into a survivable hit). We already compute KO probabilities with
  Tera slices, so measuring "does Tera move a KO threshold" is cheap.

- **Shallow unpruned expectiminimax has a hard horizon** — Foul Play abandoned
  it because it timed out past ~5 turns. Our d1/d2 search literally *cannot see*
  a better Tera window several turns away, so it will never learn to "wait" on
  its own. **The option value must live in the eval term**, not be discovered by
  deeper search. This is the central architectural argument for the change.

- **Our omniscience is an advantage here.** Other bots' strength is dominated by
  hidden-information / set-prediction quality; ours removes that error source
  entirely, so our remaining edge is decision quality on resources like Tera —
  a well-designed Tera-timing eval is exactly where marginal strength is left.

### Gap in the research

The **competitive theory of *when* to Tera** (offensive/defensive/tempo windows,
"Tera to win the game not the turn", what separates a good from a wasted Tera)
did **not** survive verification — the Smogon/VGC sources were rated unreliable
and the adversarial verifier killed those claims (forum/strategy prose is hard
to verify, and arxiv/Smogon repeatedly 403'd through the proxy). Part 2 below is
therefore **domain knowledge, not verified research** — flagged as such.

## Part 2 — Competitive Tera-timing theory (domain knowledge, unverified)

The windows strong players actually Tera in, all of which reduce to *changing
the outcome of an interaction you couldn't otherwise win*:

- **Offensive:** Tera to secure a KO you'd otherwise miss (STAB/adaptability
  boost), to enable a sweep (your win condition needs the extra power/coverage
  to break the last wall), or to win a damage race.
- **Defensive:** Tera to survive an otherwise-lethal hit (change your type so
  the incoming move is resisted / not super-effective), to shed a crippling
  weakness, or to become immune to a status/move that would end you.
- **Tempo/positional:** flip a specific matchup, remove a check's ability to
  wall you, or clean up the endgame.

The unifying rule of thumb: **"Tera to win the game, not the turn."** A *wasted*
Tera is one spent for incremental value (a bit more chip, a marginally better
matchup) when the interaction wasn't going to be lost anyway — because Tera is a
one-time resource, spending it early forecloses a later, higher-value window.
The information/bluff value ("don't show your hand") is real for humans but
**irrelevant to us** — our AI is omniscient, both Tera types are already known.
What remains is pure **optionality**: the value of keeping the option to Tera at
the single highest-impact moment.

## Part 3 — Proposed eval redesign (for review, not yet implemented)

Replace the flat `TERA_AVAILABLE = +10` with an **option-value hold bonus** plus
a **KO-flip gate** on when Tera's immediate value should count.

**A. Hold bonus = decaying option value.** Keep a bonus for *still having* Tera,
but (i) size it above the typical incremental Tera gain so small edges never
justify spending it, and (ii) **decay it as the game progresses** (by turn count
or, better, by fainted-Pokémon count — a game-phase proxy). Early game the hold
bonus is high (many future windows remain → wait); by the endgame it →0
(use-it-or-lose-it → spend freely). This directly kills the turn-4 behaviour:
early Tera only survives if its immediate value clears a *high* bar.

**B. KO-flip gate on immediate Tera value.** Only let Tera's immediate effect
count strongly when it **crosses a decision-relevant threshold**, not for
incremental chip/bulk:
  - *Offensive flip:* with Tera our best move KOs a real threat it wouldn't KO
    without Tera.
  - *Defensive flip:* with Tera an incoming move that would OHKO us no longer
    does **and no better line exists** (no safe switch avoids the KO).
  - Discount pure incremental gains that don't flip a KO — those are the
    premature-Tera trap.

**Decision rule the eval encodes:** *Tera now iff (KO-flip value now) > (decaying
option value of holding).* Cheap to compute — we already have the 2×2 Tera-sliced
KO table, so a KO-flip is a table diff and the hold-bonus decay is a scalar
function of turn/faints.

### Validation plan

Re-run `scripts/sim-gauntlet.ts` (already collects Tera timing) after the change
and confirm: mean Tera turn moves substantially later and teraRate drops below
100% (it holds sometimes), **without** a drop in win rate vs the current eval.
Sweep the hold-bonus magnitude / decay shape via the existing `?tera=N` knob and
a new decay parameter.

### Open questions

- Metamon (RL, PokéAgent Challenge 2025) is a plausibly stronger baseline than
  PokéChamp and wasn't covered — worth a look if we want a comparison target.
- Whether to add a small **"low future value" early-spend guard**: if no future
  KO-flip is reachable in the current matchup, don't over-hold.
- A more literal KO-flip gate (compare Tera vs no-Tera KO odds for the active in
  the still-holding state) if the decaying-bar proxy proves too blunt.

## Part 4 — Implemented + measured (shipped)

Implemented as a decaying option value in `src/engine/eval.ts`:
`teraOptionValue = TERA_AVAILABLE × max(0, 1 − faints / TERA_DECAY_FAINTS)`,
tunable per battle via `EvalOverrides` and the gauntlet `?tera=N` knob. Measured
with `scripts/sim-gauntlet.ts` (timing) and `scripts/sim-tera-ab.ts` (head-to-head
strength via per-side `evalOverridesBySide`).

**Timing sweep** (normal mode, FAST, player p1 mean Tera turn):

| eval | mean Tera turn | % through battle |
|---|---|---|
| old flat +10 | 3.3 | 13% |
| 30 / decay 8 | 7.5 | 24% |
| **50 / decay 8 (shipped)** | 12.8 | 42% |

The base value monotonically controls timing; decay(8 faints) handles endgame
spending. It still Teras ~100% *eventually* — the goal was to kill the turn-3
reflex, not to hoard forever.

**Strength A/B** (new eval vs old flat +10, side-swapped, FAST):

- 30/8 vs old, N=40: 22–18 (55%, within noise).
- **50/8 vs old, N=60: 30–30 (50%, dead neutral)** while Tera moved 6.2 → 10.6.

Conclusion: holding Tera to ~mid-game is **win-rate-neutral** — a free behavioural
improvement. **Shipped `TERA_AVAILABLE = 50`, `TERA_DECAY_FAINTS = 8`.** Applies
to all modes and both sides (zero-sum preserved). Full suite (184) + six-oh e2e
green.
