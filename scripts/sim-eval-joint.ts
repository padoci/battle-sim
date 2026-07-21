/**
 * Joint eval-weight search: the 5 knobs exposed via EvalOverrides
 * (teraAvailable, teraDecayFaints, statusThreatWeight, sweeperDangerWeight,
 * speedTierWeight) were each tuned one lever at a time in prior rounds
 * (logs/ai-round-report.md, TERA_AVAILABLE's own doc comment). This looks
 * for compounding gains from tuning them together: sample random combos
 * within a range around the shipped defaults, A/B each combo head-to-head
 * against the shipped defaults (evalOverridesBySide, sides swapped every
 * other battle), and report the best-scoring combo.
 *
 * Run:
 *   npx vite-node scripts/sim-eval-joint.ts -- [--candidates N] [--battles N] [--config fast|strong] [--seed N]
 *
 * This is a screening pass, not an acceptance test — a promising combo still
 * needs a full 40-battle scripts/sim-ai-ab.ts-style confirmation (see
 * runConfirmation below, printed at the end) before shipping.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {gen9} from '../src/data/gen';
import {teamMemberToSet} from '../src/data/team';
import type {Team} from '../src/data/types';
import {seedFromInts} from '../src/engine/rng';
import {WEIGHTS, type EvalOverrides} from '../src/engine/eval';
import {FAST, STRONG, type SearchConfig} from '../src/search/config';
import {runBattle, type BattleJob, type Policy} from '../src/search/runner';

const LOGS = 'logs';
const gen = gen9();

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const CANDIDATES = Number(flag('candidates', '8'));
const BATTLES = Number(flag('battles', '10'));
const CONFIG_NAME = flag('config', 'fast') as 'fast' | 'strong';
const RNG_SEED = Number(flag('seed', '1'));
const CFG: SearchConfig = CONFIG_NAME === 'strong' ? STRONG : FAST;

// A tiny local LCG so this is reproducible given --seed, without touching
// engine/rng.ts's Rng (which is shaped for battle-branch forking, not this).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
const rand = lcg(RNG_SEED);
const uniform = (lo: number, hi: number) => lo + rand() * (hi - lo);

/** Ranges centered on the shipped defaults — wide enough to find a genuinely
 *  different joint optimum, narrow enough that every candidate is still a
 *  plausible eval (no term zeroed out or blown up to dominate everything). */
const RANGES: Record<keyof EvalOverrides, [number, number]> = {
  teraAvailable: [WEIGHTS.TERA_AVAILABLE * 0.6, WEIGHTS.TERA_AVAILABLE * 1.4],
  teraDecayFaints: [WEIGHTS.TERA_DECAY_FAINTS * 0.6, WEIGHTS.TERA_DECAY_FAINTS * 1.4],
  statusThreatWeight: [WEIGHTS.STATUS_THREAT * 0.5, WEIGHTS.STATUS_THREAT * 1.5],
  sweeperDangerWeight: [WEIGHTS.SWEEPER_DANGER * 0.5, WEIGHTS.SWEEPER_DANGER * 1.5],
  speedTierWeight: [WEIGHTS.SPEED_TIER * 0.5, WEIGHTS.SPEED_TIER * 1.5],
};

function sampleCandidate(): Required<EvalOverrides> {
  const c = {} as Required<EvalOverrides>;
  for (const key of Object.keys(RANGES) as (keyof EvalOverrides)[]) {
    const [lo, hi] = RANGES[key];
    c[key] = Math.round(uniform(lo, hi) * 100) / 100;
  }
  return c;
}

const teams = (JSON.parse(readFileSync('test/fixtures/gen9ou.teams.full.json', 'utf8')) as Team[]).map(t =>
  t.data.map(teamMemberToSet)
);
const search = (config: SearchConfig): Policy => ({kind: 'search', config});

function runAB(label: string, candidate: EvalOverrides | undefined, seedOffset: number): {score: number; wins: number; losses: number; draws: number} {
  let wins = 0, losses = 0, draws = 0;
  for (let i = 0; i < BATTLES; i++) {
    const a = teams[i % teams.length];
    const b = teams[(i + 1) % teams.length];
    const candSide: 0 | 1 = i % 2 === 0 ? 0 : 1;
    const evalBySide: [EvalOverrides | undefined, EvalOverrides | undefined] =
      candSide === 0 ? [candidate, undefined] : [undefined, candidate];
    const job: BattleJob = {
      teams: [a, b],
      battleSeed: seedFromInts(seedOffset + i + 1, seedOffset + i + 2, seedOffset + i + 3, seedOffset + i + 4),
      searchSeed: 9000 + seedOffset + i,
      policies: [search(CFG), search(CFG)],
      maxTurns: 300,
      evalOverridesBySide: evalBySide,
    };
    const result = runBattle(gen, job);
    if (result.winner === null) draws++;
    else if (result.winner === candSide) wins++;
    else losses++;
  }
  const score = wins + draws / 2;
  console.log(`  ${label}: score ${score}/${BATTLES} (W${wins}/L${losses}/D${draws})`);
  return {score, wins, losses, draws};
}

function main() {
  mkdirSync(LOGS, {recursive: true});
  console.log(
    `sim-eval-joint: ${CANDIDATES} candidates x ${BATTLES} battles · config=${CONFIG_NAME} · seed=${RNG_SEED}\n`
  );
  const start = performance.now();

  const rows: {candidate: Required<EvalOverrides>; score: number; wins: number; losses: number; draws: number}[] = [];
  for (let c = 0; c < CANDIDATES; c++) {
    const candidate = sampleCandidate();
    console.log(`candidate ${c + 1}/${CANDIDATES}: ${JSON.stringify(candidate)}`);
    const result = runAB(`candidate ${c + 1}`, candidate, c * 10_000);
    rows.push({candidate, ...result});
  }

  rows.sort((a, b) => b.score - a.score);
  const elapsed = (performance.now() - start) / 1000;

  const lines = [
    `## Joint eval-weight search (config=${CONFIG_NAME}, ${CANDIDATES} candidates x ${BATTLES} battles, ${elapsed.toFixed(0)}s)`,
    '',
    `Baseline (shipped defaults): TERA_AVAILABLE=${WEIGHTS.TERA_AVAILABLE}, TERA_DECAY_FAINTS=${WEIGHTS.TERA_DECAY_FAINTS}, STATUS_THREAT=${WEIGHTS.STATUS_THREAT}, SWEEPER_DANGER=${WEIGHTS.SWEEPER_DANGER}, SPEED_TIER=${WEIGHTS.SPEED_TIER}`,
    '',
    '| rank | score | teraAvail | teraDecay | statusThreat | sweeperDanger | speedTier |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(
      (r, i) =>
        `| ${i + 1} | ${r.score}/${BATTLES} | ${r.candidate.teraAvailable} | ${r.candidate.teraDecayFaints} | ${r.candidate.statusThreatWeight} | ${r.candidate.sweeperDangerWeight} | ${r.candidate.speedTierWeight} |`
    ),
    '',
    `Best candidate scored ${rows[0].score}/${BATTLES} vs baseline defaults (chance level = ${BATTLES / 2}/${BATTLES}).`,
    'This is a screening pass, not an acceptance test — confirm any promising',
    'candidate with a dedicated 40-battle scripts/sim-ai-ab.ts-style run before shipping.',
  ];

  writeFileSync(`${LOGS}/eval-joint-search.md`, lines.join('\n'));
  console.log(`\n${lines.join('\n')}\n`);
  console.log(`wrote ${LOGS}/eval-joint-search.md`);
}

main();
