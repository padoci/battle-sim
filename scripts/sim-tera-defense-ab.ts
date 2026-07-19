/**
 * A/B strength test for defensive Tera-candidate ranking: the NEW search
 * config (teraDefenseWeight: 1 — the shipped default) vs the OLD, offense-
 * only ranking (teraDefenseWeight: 0), head-to-head. Sides swapped every
 * other battle; teams rotate through the real fixture pool.
 *
 * This is a SearchConfig lever (not an EvalOverrides one — the fix lives
 * entirely in root-candidate ranking, not the eval), so it goes through the
 * per-side-config asymmetric path, same shape as scripts/sim-ai-ab.ts's
 * "breadth" lever.
 *
 * Required behavioral probe (not optional — the prior scripts/sim-tera-ab.ts
 * round landed exactly 50/50, and win rate alone can't tell "neutral because
 * sound" from "neutral because the new candidate is never actually picked"):
 * in the asymmetric path each side independently computes root candidates
 * for BOTH sides under its OWN config (the documented "deliberate v1
 * simplification" in chooseAction), so with collectTrace:true we get, for
 * free, two independent candidate lists per turn for the same side — one
 * under NEW_CFG, one under OLD_CFG. Because teraDefenseWeight only touches
 * moveThreat's Status branch, a Tera'd action that's present in NEW's list
 * but absent from OLD's list can only be a newly-competitive Tera+status
 * play (a non-status Tera candidate's score is bit-for-bit identical either
 * way, so it can only ever be displaced OUT of the top-2 by the change,
 * never newly added). So: chosen, tera'd, present in NEW's list, absent from
 * OLD's list => a confirmed new defensive-Tera-support play.
 *
 * Run:
 *   npx vite-node scripts/sim-tera-defense-ab.ts -- [--runs N] [--config fast|strong] [--logs N]
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {gen9} from '../src/data/gen';
import {teamMemberToSet} from '../src/data/team';
import type {Team} from '../src/data/types';
import {seedFromInts} from '../src/engine/rng';
import type {Action} from '../src/engine/actions';
import {FAST, STRONG, type SearchConfig} from '../src/search/config';
import {runBattle, type BattleJob, type Policy} from '../src/search/runner';
import {renderBattle} from '../src/search/render';
import type {TurnTrace} from '../src/search/search';

const LOGS = 'logs';
const gen = gen9();

function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const RUNS = Number(flag('runs', '40'));
const CONFIG_NAME = flag('config', 'fast') as 'fast' | 'strong';
const SAMPLE_LOGS = Number(flag('logs', '3'));
const NEW_CFG: SearchConfig = CONFIG_NAME === 'strong' ? STRONG : FAST;
const OLD_CFG: SearchConfig = {...NEW_CFG, teraDefenseWeight: 0};

const teams = (JSON.parse(readFileSync('test/fixtures/gen9ou.teams.full.json', 'utf8')) as Team[]).map(t =>
  t.data.map(teamMemberToSet)
);
const search = (config: SearchConfig): Policy => ({kind: 'search', config});

function actionKey(a: Action): string {
  if (a.kind === 'move') return `move${a.slot}${a.tera ? '+tera' : ''}`;
  if (a.kind === 'switch') return `switch${a.slot}`;
  return 'pass';
}

/**
 * Confirmed new defensive-Tera-support plays in one battle's trace: for each
 * turn, pair the NEW-cfg-owner's trace with the OLD-cfg-owner's trace (same
 * side of the board, same turn), and check whether the NEW side's *chosen*
 * action is a tera'd move present in its own candidate list but absent from
 * the other trace's list for that same side.
 */
function countDefensiveTeraPlays(trace: TurnTrace[] | undefined, newSide: 0 | 1): number {
  if (!trace) return 0;
  const byTurn = new Map<number, TurnTrace[]>();
  for (const t of trace) byTurn.set(t.turn, [...(byTurn.get(t.turn) ?? []), t]);

  let count = 0;
  for (const entries of byTurn.values()) {
    const newTrace = entries.find(t => t.chosen[newSide] >= 0 && t.actions !== undefined);
    // The other trace entry for the same turn (the opposing side's own
    // decision) computed both sides' candidates under ITS OWN cfg (OLD_CFG).
    const oldTrace = entries.find(t => t !== newTrace);
    if (!newTrace || !oldTrace) continue;

    const chosenIndex = newTrace.chosen[newSide];
    const chosen = newTrace.actions[newSide][chosenIndex];
    if (!chosen || chosen.kind !== 'move' || !chosen.tera) continue;

    const key = actionKey(chosen);
    const oldKeys = new Set(oldTrace.actions[newSide].map(actionKey));
    if (!oldKeys.has(key)) count++;
  }
  return count;
}

function main() {
  mkdirSync(LOGS, {recursive: true});
  console.log(`sim-tera-defense-ab: ${RUNS} battles · config=${CONFIG_NAME} · NEW (teraDefenseWeight=1) vs OLD (=0)\n`);
  const start = performance.now();

  let newWins = 0;
  let oldWins = 0;
  let draws = 0;
  let confirmedNewPlays = 0;
  let battlesWithNewPlay = 0;
  let sampleLogsWritten = 0;

  for (let i = 0; i < RUNS; i++) {
    const a = teams[i % teams.length];
    const b = teams[(i + 1) % teams.length];
    const newSide: 0 | 1 = i % 2 === 0 ? 0 : 1;

    const policies: [Policy, Policy] =
      newSide === 0 ? [search(NEW_CFG), search(OLD_CFG)] : [search(OLD_CFG), search(NEW_CFG)];

    const job: BattleJob = {
      teams: [a, b],
      battleSeed: seedFromInts(i + 1, i + 2, i + 3, i + 4),
      searchSeed: 12000 + i,
      policies,
      maxTurns: 300,
      collectTrace: true,
      collectLog: sampleLogsWritten < SAMPLE_LOGS,
    };
    const result = runBattle(gen, job);
    if (result.winner === null) draws++;
    else if (result.winner === newSide) newWins++;
    else oldWins++;

    const plays = countDefensiveTeraPlays(result.trace, newSide);
    confirmedNewPlays += plays;
    if (plays > 0) battlesWithNewPlay++;

    if (sampleLogsWritten < SAMPLE_LOGS && plays > 0) {
      const names: [string, string] = newSide === 0 ? ['NEW', 'OLD'] : ['OLD', 'NEW'];
      writeFileSync(`${LOGS}/battle-tera-defense-${sampleLogsWritten + 1}.txt`, renderBattle(result, names));
      sampleLogsWritten++;
    }

    process.stdout.write(`\r${i + 1}/${RUNS} — NEW ${newWins} / OLD ${oldWins} / draw ${draws} · defensive plays ${confirmedNewPlays}   `);
  }

  const elapsed = (performance.now() - start) / 1000;
  const score = newWins + draws / 2;
  const decided = newWins + oldWins;

  const md =
    `## Tera defense A/B — config=${CONFIG_NAME} (${RUNS} battles, ${elapsed.toFixed(0)}s)\n\n` +
    `### Strength\n\n` +
    `- NEW wins **${newWins}** · OLD wins **${oldWins}** · draws ${draws}\n` +
    `- NEW score (wins + draws/2): **${score}/${RUNS}** — ${score >= RUNS / 2 ? 'ACCEPT (non-negative)' : 'REJECT'} on win rate alone\n` +
    `- NEW win rate of decided: **${decided ? ((newWins / decided) * 100).toFixed(0) : 0}%**\n\n` +
    `### Behavioral probe (is the mechanism actually live?)\n\n` +
    `- Confirmed new defensive-Tera-support plays: **${confirmedNewPlays}** total, in **${battlesWithNewPlay}/${RUNS}** battles\n` +
    `- A "confirmed new play" = a chosen, tera'd action that appears in NEW's root candidates but was absent from OLD's for the same side/turn — i.e. the fix changed what got considered, not just relabeled something already kept.\n` +
    `- ${confirmedNewPlays > 0 ? 'Mechanism is live.' : 'Mechanism never fired in this sample — do not ship on a win-rate result alone; check teraDefenseThreshold or scenario coverage.'}\n` +
    (sampleLogsWritten
      ? `- Sample logs: ${Array.from({length: sampleLogsWritten}, (_, k) => `logs/battle-tera-defense-${k + 1}.txt`).join(', ')}\n`
      : '');

  writeFileSync(`${LOGS}/tera-defense-ab.md`, md);
  console.log(`\n\n${md}`);
  console.log(`wrote ${LOGS}/tera-defense-ab.md`);
}

main();
