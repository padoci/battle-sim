/**
 * Generates the battle the landing page replays.
 *
 * Usage:
 *   npx vite-node scripts/build-landing-reel.ts
 *
 * Writes src/data/landing-reel.gen9ou.json — a real, complete Showdown
 * protocol log, produced by the same engine and search the app runs, so the
 * landing page is showing an actual battle rather than a mock-up of one.
 *
 * It searches seeds for a battle worth watching, because most aren't. The
 * criteria, in the order they matter:
 *
 *   - YOUR side has to win. This is the first thing a visitor sees; the app
 *     can be honest about a team's weaknesses two clicks later, on a screen
 *     they asked for.
 *   - Long enough to show the game (both sides using their team), short
 *     enough that the loop isn't interminable.
 *   - Decided, not stalled: a real KO ends it, no decision-cap draw.
 *   - Some Tera, because it's the mechanic the eval spends the most effort on
 *     and it looks like nothing else on screen.
 *
 * Re-run it only if you want a different battle. The output is vendored, so
 * nothing in the app build or the test suite depends on this script running.
 */
import {writeFileSync} from 'node:fs';
import {gen9} from '../src/data/gen';
import {seedFromInts} from '../src/engine/rng';
import {FAST} from '../src/search/config';
import {runBattle} from '../src/search/runner';
import {parseProtocol} from '../src/replay/parse';
import {toBeats} from '../src/replay/pace';
import {teamMemberToSet} from '../src/data/team';
import type {PokemonSet, Team} from '../src/data/types';
import teamsFixture from '../test/fixtures/teams.fixture.json';

const OUT = 'src/data/landing-reel.gen9ou.json';

/** Turn window: below this it reads as a stomp, above it the loop drags. */
const MIN_TURNS = 14;
const MAX_TURNS = 34;

const gen = gen9();
const teams = teamsFixture as Team[];
const sides: [PokemonSet[], PokemonSet[]] = [
  teams[0].data.map(teamMemberToSet),
  teams[1].data.map(teamMemberToSet),
];

interface Candidate {
  seed: number;
  log: string[];
  turns: number;
  beats: number;
  durationMs: number;
  faints: number;
  teras: number;
  score: number;
}

function evaluateLog(seed: number, log: string[], turns: number): Candidate {
  const events = parseProtocol(log, ['Your', 'The opposing']);
  const beats = toBeats(events);
  const durationMs = beats.reduce((sum, b) => sum + b.durationMs, 0);
  const faints = events.filter(e => e.kind === 'faint').length;
  const teras = events.filter(e => e.kind === 'tera').length;
  // Prefer a decisive, eventful battle: KOs and Tera are what make the stage
  // worth looking at. Turn count is already gated, so it only breaks ties.
  const score = faints * 3 + teras * 4 + Math.min(turns, 24) * 0.2;
  return {seed, log, turns, beats: beats.length, durationMs, faints, teras, score};
}

function main() {
  const searched = Number(process.env.SEEDS ?? 60);
  let best: Candidate | undefined;
  let wins = 0;

  for (let seed = 1; seed <= searched; seed++) {
    const result = runBattle(gen, {
      teams: sides,
      battleSeed: seedFromInts(seed, seed * 7 + 1, seed * 13 + 5, seed * 31 + 11),
      searchSeed: seed * 1009,
      policies: [
        {kind: 'search', config: FAST},
        {kind: 'search', config: FAST},
      ],
      collectLog: true,
    });

    // winner 0 is "your" side; 1 is the opponent; null is the decision cap.
    if (result.winner !== 0 || !result.protocolLog) continue;
    wins++;
    if (result.turns < MIN_TURNS || result.turns > MAX_TURNS) continue;

    const candidate = evaluateLog(seed, result.protocolLog, result.turns);
    if (!best || candidate.score > best.score) {
      best = candidate;
      console.log(
        `seed ${seed}: ${candidate.turns} turns, ${candidate.faints} KOs, ` +
          `${candidate.teras} tera, ${(candidate.durationMs / 1000).toFixed(0)}s, score ${candidate.score.toFixed(1)}`
      );
    }
  }

  if (!best) {
    console.error(
      `no battle in ${searched} seeds met the criteria ` +
        `(${wins} were wins, but none landed in ${MIN_TURNS}-${MAX_TURNS} turns). ` +
        'Widen the turn window or raise SEEDS.'
    );
    process.exit(1);
  }

  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        note:
          'Vendored by scripts/build-landing-reel.ts — a real FAST-vs-FAST battle, ' +
          'replayed on the landing page. Side 0 ("Your") wins.',
        seed: best.seed,
        turns: best.turns,
        beats: best.beats,
        durationMs: best.durationMs,
        log: best.log,
      },
      null,
      0
    )}\n`
  );

  const kb = (JSON.stringify(best.log).length / 1024).toFixed(1);
  console.log(
    `\nwrote ${OUT}: seed ${best.seed}, ${best.turns} turns, ${best.beats} beats, ` +
      `${(best.durationMs / 1000).toFixed(0)}s at 1x, log ${kb}KB`
  );
}

main();
