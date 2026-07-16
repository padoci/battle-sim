/**
 * Stage 2 measurement gate — Node side. Run: `npx vite-node scripts/measure.ts`
 * (append `--render-only` to just regenerate the report from saved JSONs,
 * e.g. after scripts/measure-browser.mjs adds browser numbers).
 *
 * Produces logs/node-results.json, logs/battle-*.txt, logs/gate-report.md.
 */
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {gen9} from '../src/data/gen';
import {teamMemberToSet} from '../src/data/team';
import type {Team} from '../src/data/types';
import {seedFromInts} from '../src/engine/rng';
import {FAST, STRONG, type SearchConfig} from '../src/search/config';
import {renderBattle} from '../src/search/render';
import {runBattle, type BattleJob, type BattleResult, type Policy} from '../src/search/runner';

const LOGS = 'logs';
const gen = gen9();

const allTeams = (JSON.parse(readFileSync('test/fixtures/gen9ou.teams.full.json', 'utf8')) as Team[])
  .map(t => ({name: t.name ?? 'unnamed', sets: t.data.map(teamMemberToSet)}));

function teamPair(i: number): {teams: BattleJob['teams']; names: [string, string]} {
  // Rotate through the first four real teams; (i+1)%4 never equals i%4.
  const a = allTeams[i % 4];
  const b = allTeams[(i + 1) % 4];
  return {teams: [a.sets, b.sets], names: [a.name, b.name]};
}

function job(i: number, policies: [Policy, Policy], extra: Partial<BattleJob> = {}): BattleJob {
  return {
    teams: teamPair(i).teams,
    battleSeed: seedFromInts(i + 1, i + 2, i + 3, i + 4),
    searchSeed: 9000 + i,
    policies,
    maxTurns: 200,
    ...extra,
  };
}

const search = (config: SearchConfig): Policy => ({kind: 'search', config});
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

interface CostRow {
  battles: number;
  msPerDecisionMean: number;
  msPerDecisionP50: number;
  msPerDecisionP95: number;
  nodesPerDecision: number;
  msPerBattle: number;
  msTable: number;
  decisionsPerBattle: number;
  draws: number;
}

function costStats(results: BattleResult[], totalMs: number): CostRow {
  return {
    battles: results.length,
    msPerDecisionMean: mean(results.map(r => r.msPerDecision.mean)),
    msPerDecisionP50: mean(results.map(r => r.msPerDecision.p50)),
    msPerDecisionP95: mean(results.map(r => r.msPerDecision.p95)),
    nodesPerDecision: mean(results.map(r => r.nodesPerDecision)),
    msPerBattle: totalMs / results.length,
    msTable: mean(results.map(r => r.msTable)),
    decisionsPerBattle: mean(results.map(r => r.decisions)),
    draws: results.filter(r => r.winner === null).length,
  };
}

function runBatch(label: string, jobs: BattleJob[]): {results: BattleResult[]; totalMs: number} {
  const results: BattleResult[] = [];
  const start = performance.now();
  for (const [i, j] of jobs.entries()) {
    results.push(runBattle(gen, j));
    process.stdout.write(`\r${label}: ${i + 1}/${jobs.length}   `);
  }
  const totalMs = performance.now() - start;
  console.log(`\r${label}: done in ${(totalMs / 1000).toFixed(1)}s`);
  return {results, totalMs};
}

/** Mean Shannon entropy (bits) of the root strategy actually used per turn. */
function meanRootEntropy(results: BattleResult[]): number {
  const entropies: number[] = [];
  for (const result of results) {
    for (const trace of result.trace ?? []) {
      for (const dist of [trace.solution.row, trace.solution.col]) {
        let h = 0;
        for (const p of dist) if (p > 0) h -= p * Math.log2(p);
        entropies.push(h);
      }
    }
  }
  return mean(entropies);
}

function main() {
  mkdirSync(LOGS, {recursive: true});
  const renderOnly = process.argv.includes('--render-only');

  if (!renderOnly) {
    const node: Record<string, unknown> = {};

    // --- Cost: d1 and d2 self-play ---
    const d1 = runBatch('cost d1 (FAST self-play, 40)', Array.from({length: 40}, (_, i) => job(i, [search(FAST), search(FAST)])));
    node['costD1'] = costStats(d1.results, d1.totalMs);

    const d2 = runBatch('cost d2 (STRONG self-play, 10)', Array.from({length: 10}, (_, i) => job(i, [search(STRONG), search(STRONG)])));
    node['costD2'] = costStats(d2.results, d2.totalMs);

    // --- Strength ---
    const vsRandom = runBatch(
      'strength d1 vs random (40)',
      Array.from({length: 40}, (_, i) =>
        job(i, i % 2 === 0 ? [search(FAST), {kind: 'random'}] : [{kind: 'random'}, search(FAST)])
      )
    );
    const searchWins = vsRandom.results.filter((r, i) => r.winner === (i % 2 === 0 ? 0 : 1)).length;
    node['d1VsRandom'] = {battles: 40, searchWins, winRate: searchWins / 40};

    const d2VsD1 = runBatch(
      'strength d2 vs d1 (20)',
      Array.from({length: 20}, (_, i) =>
        job(500 + i, i % 2 === 0 ? [search(STRONG), search(FAST)] : [search(FAST), search(STRONG)])
      )
    );
    const d2Wins = d2VsD1.results.filter((r, i) => r.winner === (i % 2 === 0 ? 0 : 1)).length;
    const d2Draws = d2VsD1.results.filter(r => r.winner === null).length;
    node['d2VsD1'] = {battles: 20, d2Wins, draws: d2Draws, winRate: d2Wins / 20};

    // --- Self-play balance + mixing ---
    const balance = runBatch(
      'd1 self-play balance (30)',
      Array.from({length: 30}, (_, i) => job(1000 + i, [search(FAST), search(FAST)], {collectTrace: true}))
    );
    node['selfPlay'] = {
      battles: 30,
      p1Wins: balance.results.filter(r => r.winner === 0).length,
      p2Wins: balance.results.filter(r => r.winner === 1).length,
      draws: balance.results.filter(r => r.winner === null).length,
      meanRootEntropyBits: meanRootEntropy(balance.results),
    };

    writeFileSync(`${LOGS}/node-results.json`, JSON.stringify(node, null, 2));

    // --- Battle logs for the human gate ---
    const logJobs: Array<{file: string; job: BattleJob; names: [string, string]}> = [
      ...[1, 2, 3].map(s => ({
        file: `battle-d2-selfplay-${s}.txt`,
        job: job(2000 + s, [search(STRONG), search(STRONG)], {collectTrace: true, collectLog: true}),
        names: ['P1', 'P2'] as [string, string],
      })),
      {
        file: 'battle-d1-selfplay.txt',
        job: job(2010, [search(FAST), search(FAST)], {collectTrace: true, collectLog: true}),
        names: ['P1', 'P2'],
      },
      {
        file: 'battle-d1-vs-random.txt',
        job: job(2011, [search(FAST), {kind: 'random'}], {collectTrace: true, collectLog: true}),
        names: ['SearchAI', 'RandomAI'],
      },
    ];
    for (const entry of logJobs) {
      const result = runBattle(gen, entry.job);
      writeFileSync(`${LOGS}/${entry.file}`, renderBattle(result, entry.names));
      console.log(`wrote ${LOGS}/${entry.file} (winner ${result.winner}, ${result.turns} turns)`);
    }
  }

  renderReport();
}

function fmt(n: number, digits = 1): string {
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function renderReport() {
  const node = JSON.parse(readFileSync(`${LOGS}/node-results.json`, 'utf8'));
  const browserPath = `${LOGS}/browser-results.json`;
  const browser = existsSync(browserPath) ? JSON.parse(readFileSync(browserPath, 'utf8')) : null;

  const cost = (row: CostRow | undefined, extra?: {startupMs?: number}) =>
    row
      ? `${fmt(row.msPerDecisionMean)} / ${fmt(row.msPerDecisionP50)} / ${fmt(row.msPerDecisionP95)} | ${fmt(row.nodesPerDecision, 0)} | ${fmt(row.msPerBattle / 1000, 1)}s | ${fmt(row.msTable, 0)} | ${extra?.startupMs !== undefined ? fmt(extra.startupMs, 0) : '—'} | ${fmt(60000 / row.msPerBattle, 1)}`
      : '— (not run)';

  const browserRow = (name: 'fast' | 'strong') => {
    const entry = browser?.[name];
    if (!entry) return '— | — | — | — | — | —';
    return `${fmt(entry.msPerDecision.mean)} / ${fmt(entry.msPerDecision.p50)} / ${fmt(entry.msPerDecision.p95)} | ${fmt(entry.nodesPerDecision, 0)} | ${fmt(entry.msPerBattle / 1000, 1)}s | ${fmt(entry.msTableMean, 0)} | ${fmt(entry.startupMs, 0)} | ${fmt(60000 / entry.msPerBattle, 1)}`;
  };

  const report = `# Stage 2 Measurement Gate Report

**This is the go/no-go on the AI approach (HANDOFF stage 2; search spec §5).**

## Watch-for checklist (human review)

Read the battle logs in this directory and judge:
- Does it switch into obvious KOs? Does it preserve win conditions?
- Does it actually **mix/bluff** (look for p<1.00 choices), or is every turn pure?
- Is Tera timing sane — not wasted turn 1, not hoarded forever?
- Any turn where the chosen action is inexplicable given the printed root value?
- Does d1-vs-random look like a competent player beating a fish?

Suggested thresholds: browser d1 ≤ ~150 ms/turn (100-battle test-your-team run ≈ 5 min);
browser d2 ≤ ~2 s/turn (cinematic); d1 ≥90% vs random; d2 ≥55% vs d1.
If missed: pruning knobs first (interior 3×2, rootSwitchK=1), then search-spec §6 escalation.

## Table 1 — Cost

| config | runtime | ms/decision mean/p50/p95 | nodes/dec | s/battle | table ms | startup ms | battles/min |
|---|---|---|---|---|---|---|---|
| d1 FAST | Node | ${cost(node.costD1)} |
| d1 FAST | browser worker | ${browserRow('fast')} |
| d2 STRONG | Node | ${cost(node.costD2)} |
| d2 STRONG | browser worker | ${browserRow('strong')} |

(browser rows are the primary gate numbers${browser ? '' : ' — NOT YET RUN: `node scripts/measure-browser.mjs`'})

## Table 2 — Strength (Node)

| matchup | battles | result |
|---|---|---|
| d1 vs random | ${node.d1VsRandom.battles} | **${(node.d1VsRandom.winRate * 100).toFixed(0)}%** search wins (${node.d1VsRandom.searchWins}) |
| d2 vs d1 | ${node.d2VsD1.battles} | **${(node.d2VsD1.winRate * 100).toFixed(0)}%** d2 wins (${node.d2VsD1.d2Wins}, ${node.d2VsD1.draws} draws) |
| d1 self-play balance | ${node.selfPlay.battles} | P1 ${node.selfPlay.p1Wins} — P2 ${node.selfPlay.p2Wins} — draws ${node.selfPlay.draws} |
| root mixing | — | mean strategy entropy ${fmt(node.selfPlay.meanRootEntropyBits, 2)} bits/decision |

## Battle logs

- battle-d2-selfplay-{1,2,3}.txt — STRONG self-play (watch these closest)
- battle-d1-selfplay.txt — FAST self-play
- battle-d1-vs-random.txt — sanity: competent vs fish

## Notes

- Symmetry note: exact zero-sum/mirror invariants hold at the solver and eval level
  (unit-tested); end-to-end side balance is statistical because the sim's own
  p1/p2 tie-breaks and per-cell PRNG forks differ.
- Chance handling is single-sample per matrix cell + eval smoothing
  (koProb/expectedFrac); \`samplesPerCell\` is the reserve knob if logs show
  noise-driven misplays.
`;
  writeFileSync(`${LOGS}/gate-report.md`, report);
  console.log(`wrote ${LOGS}/gate-report.md`);
}

main();
