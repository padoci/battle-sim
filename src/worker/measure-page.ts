/**
 * Browser-worker measurement page (the REAL gate numbers — browser JIT
 * differs from Node). Plain TS, no React. Drives the sim worker and
 * exposes the aggregated report on `window.__gateReport` for the
 * Playwright harness (scripts/measure-browser.mjs).
 */
import {teamMemberToSet} from '../data/team';
import type {Team} from '../data/types';
import {seedFromInts} from '../engine/rng';
import {FAST, STRONG} from '../search/config';
import type {BattleJob, BattleResult} from '../search/runner';
import {createSimClient} from './client';
import teamsFixture from '../../test/fixtures/teams.fixture.json';

interface GateReport {
  config: string;
  battles: number;
  startupMs: number;
  totalMs: number;
  msPerDecision: {mean: number; p50: number; p95: number};
  nodesPerDecision: number;
  msPerBattle: number;
  msTableMean: number;
  decisionsPerBattle: number;
  wins: [number, number, number];
}

declare global {
  interface Window {
    __gateReport?: GateReport;
    __gateError?: string;
  }
}

const out = document.getElementById('out')!;
const print = (line: string) => (out.textContent += `\n${line}`);

async function main() {
  const params = new URLSearchParams(location.search);
  const battles = Number(params.get('battles') ?? 10);
  const configName = params.get('config') ?? 'fast';
  const seed = Number(params.get('seed') ?? 1);
  const config = configName === 'strong' ? STRONG : FAST;

  const teams = (teamsFixture as Team[]).map(t => t.data.map(teamMemberToSet));
  const jobs: BattleJob[] = Array.from({length: battles}, (_, i) => ({
    teams: [teams[i % 2], teams[(i + 1) % 2]] as BattleJob['teams'],
    battleSeed: seedFromInts(seed + i, i + 1, i + 2, i + 3),
    searchSeed: seed * 1000 + i,
    policies: [
      {kind: 'search', config},
      {kind: 'search', config},
    ],
    maxTurns: 200,
  }));

  const client = createSimClient();
  const startupMs = await client.ready;
  print(`worker ready in ${startupMs.toFixed(0)} ms; running ${battles} ${configName} battles…`);

  const start = performance.now();
  const {results} = await client.run(jobs, (done, total, result) => {
    print(`battle ${done}/${total}: winner ${result.winner} in ${result.turns} turns, ${result.msPerDecision.mean.toFixed(0)} ms/decision`);
  });
  const totalMs = performance.now() - start;

  const all = (selector: (r: BattleResult) => number) => results.map(selector);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const decisionMeans = all(r => r.msPerDecision.mean);
  const wins: [number, number, number] = [
    results.filter(r => r.winner === 0).length,
    results.filter(r => r.winner === 1).length,
    results.filter(r => r.winner === null).length,
  ];

  window.__gateReport = {
    config: configName,
    battles,
    startupMs,
    totalMs,
    msPerDecision: {
      mean: mean(decisionMeans),
      p50: mean(all(r => r.msPerDecision.p50)),
      p95: mean(all(r => r.msPerDecision.p95)),
    },
    nodesPerDecision: mean(all(r => r.nodesPerDecision)),
    msPerBattle: totalMs / battles,
    msTableMean: mean(all(r => r.msTable)),
    decisionsPerBattle: mean(all(r => r.decisions)),
    wins,
  };
  print(`done: ${JSON.stringify(window.__gateReport, null, 2)}`);
  client.terminate();
}

main().catch(error => {
  window.__gateError = String(error);
  print(`ERROR: ${String(error)}`);
});
