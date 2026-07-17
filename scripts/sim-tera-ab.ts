/**
 * A/B strength test for the Tera-timing eval: the NEW eval (decaying option
 * value, current WEIGHTS defaults) vs the OLD flat +10 bonus, head-to-head at
 * the same search config. Sides are swapped every other battle to cancel any
 * p1/p2 bias. Reports the new eval's win rate (does holding Tera help or hurt?)
 * and each eval's mean Tera turn (does the new one actually hold longer?).
 *
 * Run:
 *   npx vite-node scripts/sim-tera-ab.ts -- [--runs N] [--config fast|strong]
 *
 * The OLD eval is reproduced via per-side evalOverrides {teraAvailable:10,
 * teraDecayFaints:0}; the NEW eval is the code default (undefined override).
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {gen9} from '../src/data/gen';
import {teamMemberToSet} from '../src/data/team';
import type {Team} from '../src/data/types';
import {seedFromInts} from '../src/engine/rng';
import type {EvalOverrides} from '../src/engine/eval';
import {FAST, STRONG, type SearchConfig} from '../src/search/config';
import {runBattle, type BattleJob, type Policy} from '../src/search/runner';

const LOGS = 'logs';
const gen = gen9();

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const RUNS = Number(flag('runs', '30'));
const CONFIG_NAME = flag('config', 'fast') as 'fast' | 'strong';
const CONFIG: SearchConfig = CONFIG_NAME === 'strong' ? STRONG : FAST;

// NEW eval = code default (undefined). OLD eval = the flat +10, no decay.
const OLD_EVAL: EvalOverrides = {teraAvailable: 10, teraDecayFaints: 0};

const teams = (JSON.parse(readFileSync('test/fixtures/gen9ou.teams.full.json', 'utf8')) as Team[]).map(t =>
  t.data.map(teamMemberToSet)
);
const search = (config: SearchConfig): Policy => ({kind: 'search', config});

/** The turn a given side terastallized (p1a/p2a), or undefined. */
function teraTurn(log: string[] | undefined, tag: string): number | undefined {
  if (!log) return undefined;
  let turn = 0;
  for (const line of log) {
    if (line.startsWith('|turn|')) {
      const n = Number(line.slice(6));
      if (Number.isFinite(n)) turn = n;
    }
    if (line.startsWith(`|-terastallize|${tag}`)) return turn;
  }
  return undefined;
}

function main() {
  mkdirSync(LOGS, {recursive: true});
  console.log(`sim-tera-ab: ${RUNS} battles · config=${CONFIG_NAME} · NEW (decaying) vs OLD (flat +10)\n`);
  const start = performance.now();

  let newWins = 0;
  let oldWins = 0;
  let draws = 0;
  const newTeraTurns: number[] = [];
  const oldTeraTurns: number[] = [];
  let newTeraed = 0;
  let oldTeraed = 0;
  let battlesCounted = 0;

  for (let i = 0; i < RUNS; i++) {
    const a = teams[i % teams.length];
    const b = teams[(i + 1) % teams.length];
    // Even i: side 0 = NEW, side 1 = OLD. Odd i: swap.
    const newSide: 0 | 1 = i % 2 === 0 ? 0 : 1;
    const evalBySide: [EvalOverrides | undefined, EvalOverrides | undefined] =
      newSide === 0 ? [undefined, OLD_EVAL] : [OLD_EVAL, undefined];

    const job: BattleJob = {
      teams: [a, b],
      battleSeed: seedFromInts(i + 1, i + 2, i + 3, i + 4),
      searchSeed: 5000 + i,
      policies: [search(CONFIG), search(CONFIG)],
      maxTurns: 300,
      collectLog: true,
      evalOverridesBySide: evalBySide,
    };
    const result = runBattle(gen, job);
    if (result.winner === null) draws++;
    else if (result.winner === newSide) newWins++;
    else oldWins++;

    const newTag = newSide === 0 ? 'p1a' : 'p2a';
    const oldTag = newSide === 0 ? 'p2a' : 'p1a';
    const nt = teraTurn(result.protocolLog, newTag);
    const ot = teraTurn(result.protocolLog, oldTag);
    if (nt !== undefined) {
      newTeraed++;
      newTeraTurns.push(nt);
    }
    if (ot !== undefined) {
      oldTeraed++;
      oldTeraTurns.push(ot);
    }
    battlesCounted++;
    process.stdout.write(`\r${i + 1}/${RUNS} — NEW ${newWins} / OLD ${oldWins} / draw ${draws}   `);
  }

  const elapsed = (performance.now() - start) / 1000;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const decided = newWins + oldWins;
  const newWinRate = decided ? newWins / decided : 0;

  const md =
    `# Tera eval A/B — NEW (decaying option value) vs OLD (flat +10)\n\n` +
    `${RUNS} battles · config=${CONFIG_NAME} · ${elapsed.toFixed(0)}s\n\n` +
    `## Strength\n\n` +
    `- NEW wins: **${newWins}** · OLD wins: **${oldWins}** · draws: ${draws}\n` +
    `- NEW win rate (of decided): **${(newWinRate * 100).toFixed(0)}%**\n` +
    `- 50% = neutral (change doesn't hurt); >50% = the new Tera timing is stronger.\n\n` +
    `## Tera timing\n\n` +
    `| eval | Tera'd in | mean Tera turn |\n|---|---|---|\n` +
    `| NEW (decaying) | ${battlesCounted ? ((newTeraed / battlesCounted) * 100).toFixed(0) : 0}% | ${avg(newTeraTurns).toFixed(1)} |\n` +
    `| OLD (flat +10) | ${battlesCounted ? ((oldTeraed / battlesCounted) * 100).toFixed(0) : 0}% | ${avg(oldTeraTurns).toFixed(1)} |\n`;

  writeFileSync(`${LOGS}/tera-ab.md`, md);
  console.log(`\n\n${md}`);
  console.log(`wrote ${LOGS}/tera-ab.md`);
}

main();
