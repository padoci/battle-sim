/**
 * A/B strength test for the "smarter d1" round: the NEW brain (status-aware
 * threat, sweeper-danger + speed-tier eval terms, wider root switches) vs the
 * OLD brain, head-to-head. Sides are swapped every other battle to cancel
 * p1/p2 bias; teams rotate through the real fixture pool.
 *
 * Run:
 *   npx vite-node scripts/sim-ai-ab.ts -- [--runs N] [--config fast|strong] [--lever eval|breadth|all]
 *
 * Levers:
 *   eval    — same search config both sides; OLD side zeroes the new eval
 *             terms via evalOverridesBySide (statusThreat/sweeperDanger/
 *             speedTier = 0 reproduces the old eval bit-for-bit).
 *   breadth — no eval overrides; OLD side searches with rootSwitchK=2.
 *             (This lever LOST its A/B — 19/40 — so shipped FAST keeps
 *             rootSwitchK=2 and the lever is now a no-op unless the config
 *             is re-widened; see logs/ai-round-report.md.)
 *   all     — OLD side gets both the old eval AND the old breadth (the
 *             headline old-brain-vs-new-brain number).
 *
 * Acceptance (logs/ai-round-report.md): NEW score (wins + draws/2) >= RUNS/2,
 * with measure.ts cost inside budget.
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
const RUNS = Number(flag('runs', '40'));
const CONFIG_NAME = flag('config', 'fast') as 'fast' | 'strong';
const LEVER = flag('lever', 'all') as 'eval' | 'breadth' | 'all';
const NEW_CFG: SearchConfig = CONFIG_NAME === 'strong' ? STRONG : FAST;
// The old search breadth, at the same depth.
const OLD_CFG: SearchConfig = {...NEW_CFG, rootSwitchK: 2};
// Zeroing the new weights reproduces the old eval exactly.
const OLD_EVAL: EvalOverrides = {statusThreatWeight: 0, sweeperDangerWeight: 0, speedTierWeight: 0};

const useOldEval = LEVER === 'eval' || LEVER === 'all';
const useOldCfg = LEVER === 'breadth' || LEVER === 'all';

const teams = (JSON.parse(readFileSync('test/fixtures/gen9ou.teams.full.json', 'utf8')) as Team[]).map(t =>
  t.data.map(teamMemberToSet)
);
const search = (config: SearchConfig): Policy => ({kind: 'search', config});

function main() {
  mkdirSync(LOGS, {recursive: true});
  console.log(`sim-ai-ab: ${RUNS} battles · config=${CONFIG_NAME} · lever=${LEVER}\n`);
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
      newSide === 0
        ? [search(NEW_CFG), search(useOldCfg ? OLD_CFG : NEW_CFG)]
        : [search(useOldCfg ? OLD_CFG : NEW_CFG), search(NEW_CFG)];
    const evalBySide: [EvalOverrides | undefined, EvalOverrides | undefined] | undefined = useOldEval
      ? newSide === 0
        ? [undefined, OLD_EVAL]
        : [OLD_EVAL, undefined]
      : undefined;

    const job: BattleJob = {
      teams: [a, b],
      battleSeed: seedFromInts(i + 1, i + 2, i + 3, i + 4),
      searchSeed: 9000 + i,
      policies,
      maxTurns: 300,
      ...(evalBySide ? {evalOverridesBySide: evalBySide} : {}),
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
    `## AI A/B — lever=${LEVER} (config=${CONFIG_NAME}, ${RUNS} battles, ${elapsed.toFixed(0)}s)\n\n` +
    `- NEW wins **${newWins}** · OLD wins **${oldWins}** · draws ${draws} · mean turns ${(turnsTotal / RUNS).toFixed(0)}\n` +
    `- NEW score (wins + draws/2): **${score}/${RUNS}** — ${score >= RUNS / 2 ? 'ACCEPT (non-negative)' : 'REJECT'}\n` +
    `- NEW win rate of decided: **${decided ? ((newWins / decided) * 100).toFixed(0) : 0}%**\n`;

  writeFileSync(`${LOGS}/ai-ab-${LEVER}.md`, md);
  console.log(`\n\n${md}`);
  console.log(`wrote ${LOGS}/ai-ab-${LEVER}.md`);
}

main();
