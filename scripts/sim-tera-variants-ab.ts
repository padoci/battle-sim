/**
 * A/B strength test for widening the root Tera-candidate cut: NEW
 * (rootTeraVariants: 3) vs OLD (rootTeraVariants: 2, the shipped default),
 * head-to-head. Sides swapped every other battle; teams rotate through the
 * real fixture pool.
 *
 * Motivation: Round 1 (logs/tera-defense-round.md) added a new competitor
 * class — defensive Tera+Status plays — into the same top-2 cut that Tera
 * attacks already compete for. This checks whether 2 root Tera slots is now
 * too narrow, now that there are more genuinely good candidates fighting for
 * them. Treated exactly like the rootSwitchK 2->3 precedent
 * (logs/ai-round-report.md): a real experiment that can lose, not a default
 * bump — REJECT keeps rootTeraVariants at 2.
 *
 * Run:
 *   npx vite-node scripts/sim-tera-variants-ab.ts -- [--runs N] [--config fast|strong]
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {gen9} from '../src/data/gen';
import {teamMemberToSet} from '../src/data/team';
import type {Team} from '../src/data/types';
import {seedFromInts} from '../src/engine/rng';
import {FAST, STRONG, type SearchConfig} from '../src/search/config';
import {runBattle, type BattleJob, type Policy} from '../src/search/runner';

const LOGS = 'logs';
const gen = gen9();

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const RUNS = Number(flag('runs', '40'));
const CONFIG_NAME = flag('config', 'fast') as 'fast' | 'strong';
const BASE: SearchConfig = CONFIG_NAME === 'strong' ? STRONG : FAST;
const NEW_CFG: SearchConfig = {...BASE, rootTeraVariants: 3};
const OLD_CFG: SearchConfig = BASE;

const teams = (JSON.parse(readFileSync('test/fixtures/gen9ou.teams.full.json', 'utf8')) as Team[]).map(t =>
  t.data.map(teamMemberToSet)
);
const search = (config: SearchConfig): Policy => ({kind: 'search', config});

function main() {
  mkdirSync(LOGS, {recursive: true});
  console.log(`sim-tera-variants-ab: ${RUNS} battles · config=${CONFIG_NAME} · NEW (rootTeraVariants=3) vs OLD (=2)\n`);
  const start = performance.now();

  let newWins = 0;
  let oldWins = 0;
  let draws = 0;
  let turnsTotal = 0;

  for (let i = 0; i < RUNS; i++) {
    const a = teams[i % teams.length];
    const b = teams[(i + 1) % teams.length];
    const newSide: 0 | 1 = i % 2 === 0 ? 0 : 1;

    const policies: [Policy, Policy] =
      newSide === 0 ? [search(NEW_CFG), search(OLD_CFG)] : [search(OLD_CFG), search(NEW_CFG)];

    const job: BattleJob = {
      teams: [a, b],
      battleSeed: seedFromInts(i + 1, i + 2, i + 3, i + 4),
      searchSeed: 13000 + i,
      policies,
      maxTurns: 300,
    };
    const result = runBattle(gen, job);
    if (result.winner === null) draws++;
    else if (result.winner === newSide) newWins++;
    else oldWins++;
    turnsTotal += result.turns;
    process.stdout.write(`\r${i + 1}/${RUNS} — NEW ${newWins} / OLD ${oldWins} / draw ${draws}   `);
  }

  const elapsed = (performance.now() - start) / 1000;
  const score = newWins + draws / 2;
  const decided = newWins + oldWins;

  const md =
    `## Tera variants A/B — config=${CONFIG_NAME} (${RUNS} battles, ${elapsed.toFixed(0)}s)\n\n` +
    `- NEW (rootTeraVariants=3) wins **${newWins}** · OLD (=2) wins **${oldWins}** · draws ${draws} · mean turns ${(turnsTotal / RUNS).toFixed(0)}\n` +
    `- NEW score (wins + draws/2): **${score}/${RUNS}** — ${score >= RUNS / 2 ? 'ACCEPT (non-negative)' : 'REJECT'}\n` +
    `- NEW win rate of decided: **${decided ? ((newWins / decided) * 100).toFixed(0) : 0}%**\n`;

  writeFileSync(`${LOGS}/tera-variants-ab.md`, md);
  console.log(`\n\n${md}`);
  console.log(`wrote ${LOGS}/tera-variants-ab.md`);
}

main();
