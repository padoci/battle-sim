/**
 * Headless "Can you 6-0?" simulator — drives full gauntlet runs in Node with
 * the real draft engine + search, no browser. Collects how far runs get, the
 * per-rung win rate, and the flawless rate, so we can see whether a mode (and
 * the Easy difficulty ramp in particular) behaves as intended.
 *
 * Run:
 *   npx vite-node scripts/sim-gauntlet.ts -- [--runs N] [--config fast|strong]
 *                 [--modes easy,normal,hard] [--draft greedy|random] [--seed S]
 *
 * Defaults: 15 runs per mode, FAST search, modes easy+normal, greedy draft.
 * Note FAST understates the shipped default (STRONG); it keeps a batch quick
 * and, because Easy's top rungs mirror the player's own config, the *relative*
 * difficulty across rungs is preserved either way. Writes logs/gauntlet-sim.json
 * and logs/gauntlet-sim.md.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {gen9} from '../src/data/gen';
import {teamMemberToSet} from '../src/data/team';
import type {PoolEntry, SetsData, StatsData, Team} from '../src/data/types';
import {seedFromInts} from '../src/engine/rng';
import {FAST, STRONG, type SearchConfig} from '../src/search/config';
import {runBattle, type BattleJob, type Policy} from '../src/search/runner';
import {
  createDraft,
  pickBundle,
  pickSet,
  pickSpecies,
  type DraftMode,
  type DraftState,
} from '../src/draft/draft';
import {sampleOpponents} from '../src/draft/opponents';

const LOGS = 'logs';
const gen = gen9();

// ---- CLI ----
function flag(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const RUNS = Number(flag('runs', '15'));
const CONFIG_NAME = flag('config', 'fast') as 'fast' | 'strong';
const CONFIG: SearchConfig = CONFIG_NAME === 'strong' ? STRONG : FAST;
const MODES = flag('modes', 'easy,normal').split(',') as DraftMode[];
const DRAFT = flag('draft', 'greedy') as 'greedy' | 'random';
const BASE_SEED = Number(flag('seed', '1000'));
/** Easy ramp shape: `cliff` = shipped (random/FAST/config), `smooth` = mix-based. */
const RAMP = flag('ramp', 'cliff') as 'cliff' | 'smooth';

const search = (config: SearchConfig): Policy => ({kind: 'search', config});

// ---- Data (vendored fixtures — the sandbox blocks data.pkmn.cc) ----
const sets = JSON.parse(readFileSync('test/fixtures/gen9ou.sets.full.json', 'utf8')) as SetsData;
const stats = JSON.parse(readFileSync('test/fixtures/stats.fixture.json', 'utf8')) as unknown as StatsData;
const teams = JSON.parse(readFileSync('test/fixtures/gen9ou.teams.full.json', 'utf8')) as Team[];
const pool: PoolEntry[] = Object.entries(sets).map(([species, byName]) => ({
  species,
  setNames: Object.keys(byName),
  usageWeighted: stats.pokemon[species]?.usage.weighted ?? 0,
}));

/** Blunder rate per rung for the `smooth` ramp (75% → 0% across the six). */
const SMOOTH_EPSILON = [0.75, 0.55, 0.4, 0.25, 0.1, 0];

/**
 * The Easy difficulty ramp. `cliff` mirrors the shipped
 * src/app/sixoh/session.ts `opponentPolicy` (random → FAST → player config).
 * `smooth` uses a mix player whose blunder rate decays each rung, so the
 * curve slopes instead of jumping from random pushover to full FAST. Both
 * end at a fair mirror on the last rung. normal/hard are full strength.
 */
function opponentPolicy(mode: DraftMode, index: number): Policy {
  if (mode !== 'easy') return search(CONFIG);
  if (RAMP === 'smooth') {
    const epsilon = SMOOTH_EPSILON[index];
    if (epsilon <= 0) return search(CONFIG);
    // Weakened rungs search shallowly (FAST) under the blunders; the last
    // ramped rung uses the player's own config so it eases into the mirror.
    return {kind: 'mix', epsilon, config: index >= 4 ? CONFIG : FAST};
  }
  if (index <= 1) return {kind: 'random'};
  if (index <= 3) return search(FAST);
  return search(CONFIG);
}

/** Auto-draft a team. greedy = highest-usage species + its first set. */
function draftTeam(mode: DraftMode, seed: number) {
  let draft: DraftState = createDraft(pool, sets, mode, seed);
  const pickIndex = (n: number, offers: {usageWeighted: number}[]) =>
    DRAFT === 'random' ? seed % n : offers.reduce((best, o, i) => (o.usageWeighted > offers[best].usageWeighted ? i : best), 0);

  let guard = 0;
  while (draft.phase !== 'complete' && guard++ < 100) {
    if (mode === 'hard') {
      draft = pickBundle(draft, pool, sets, pickIndex(draft.offers.length, draft.offers));
    } else if (draft.phase === 'species') {
      const i = pickIndex(draft.offers.length, draft.offers);
      draft = pickSpecies(draft, sets, draft.offers[i].species);
    } else {
      draft = pickSet(draft, pool, sets, draft.setOptions![0].setName);
    }
  }
  return draft.team.map(p => p.set);
}

interface RunResult {
  outcome: 'flawless' | 'eliminated';
  /** 1-based rung that ended the run (7 = flawless / never lost). */
  endedAt: number;
  wins: boolean[];
  turns: number[];
  /** Turn the PLAYER (p1) Tera'd in each battle, or undefined if never. */
  teraTurns: (number | undefined)[];
}

/** The turn side p1 (the player) terastallized, scanning the protocol log. */
function playerTeraTurn(log: string[] | undefined): number | undefined {
  if (!log) return undefined;
  let turn = 0;
  for (const line of log) {
    if (line.startsWith('|turn|')) {
      const n = Number(line.slice(6));
      if (Number.isFinite(n)) turn = n;
    }
    if (line.startsWith('|-terastallize|p1a')) return turn;
  }
  return undefined;
}

function runGauntlet(mode: DraftMode, runSeed: number): RunResult {
  const team = draftTeam(mode, runSeed ^ 0xd4af7);
  const oppIdx = sampleOpponents(teams.length, 6, runSeed ^ 0x0bb57);
  const opponents = oppIdx.map(i => teams[i].data.map(teamMemberToSet));

  const wins: boolean[] = [];
  const turns: number[] = [];
  const teraTurns: (number | undefined)[] = [];
  for (let i = 0; i < 6; i++) {
    const seed = runSeed + i;
    const job: BattleJob = {
      teams: [team, opponents[i]],
      battleSeed: seedFromInts(seed & 0xffff, (seed >> 4) & 0xffff, i + 1, 7),
      searchSeed: runSeed + i * 7919,
      policies: [search(CONFIG), opponentPolicy(mode, i)],
      maxTurns: 300,
      collectLog: true,
    };
    const result = runBattle(gen, job);
    const won = result.winner === 0;
    wins.push(won);
    turns.push(result.turns);
    teraTurns.push(playerTeraTurn(result.protocolLog));
    if (!won) return {outcome: 'eliminated', endedAt: i + 1, wins, turns, teraTurns};
  }
  return {outcome: 'flawless', endedAt: 7, wins, turns, teraTurns};
}

interface ModeSummary {
  mode: DraftMode;
  runs: number;
  flawless: number;
  flawlessRate: number;
  /** eliminatedAt[k] = runs that lost their k-th battle (k = 1..6). */
  eliminatedAt: number[];
  /** perRung[i] = {played, won, rate} for rung i (0..5). */
  perRung: {played: number; won: number; rate: number}[];
  meanBattlesPerRun: number;
  meanTurns: number;
  /** Tera usage by the player (p1) across all battles played. */
  tera: {
    battles: number;
    teraedBattles: number;
    teraRate: number;
    meanTeraTurn: number;
    /** Mean fraction through the battle (teraTurn / battleTurns). */
    meanTeraFraction: number;
  };
}

function summarize(mode: DraftMode, results: RunResult[]): ModeSummary {
  const eliminatedAt = Array(7).fill(0); // index 1..6
  const perRung = Array.from({length: 6}, () => ({played: 0, won: 0, rate: 0}));
  let flawless = 0;
  let battlesTotal = 0;
  const allTurns: number[] = [];
  for (const r of results) {
    if (r.outcome === 'flawless') flawless++;
    else eliminatedAt[r.endedAt]++;
    battlesTotal += r.wins.length;
    r.wins.forEach((won, i) => {
      perRung[i].played++;
      if (won) perRung[i].won++;
    });
    allTurns.push(...r.turns);
  }
  perRung.forEach(p => (p.rate = p.played ? p.won / p.played : 0));

  // Tera timing: over every battle the player fought, when did p1 Tera?
  let teraedBattles = 0;
  const teraTurnsAll: number[] = [];
  const teraFractions: number[] = [];
  for (const r of results) {
    r.teraTurns.forEach((t, i) => {
      if (t === undefined) return;
      teraedBattles++;
      teraTurnsAll.push(t);
      if (r.turns[i] > 0) teraFractions.push(t / r.turns[i]);
    });
  }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  return {
    mode,
    runs: results.length,
    flawless,
    flawlessRate: flawless / results.length,
    eliminatedAt: eliminatedAt.slice(1),
    perRung,
    meanBattlesPerRun: battlesTotal / results.length,
    meanTurns: allTurns.reduce((a, b) => a + b, 0) / (allTurns.length || 1),
    tera: {
      battles: battlesTotal,
      teraedBattles,
      teraRate: battlesTotal ? teraedBattles / battlesTotal : 0,
      meanTeraTurn: avg(teraTurnsAll),
      meanTeraFraction: avg(teraFractions),
    },
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}

function main() {
  mkdirSync(LOGS, {recursive: true});
  console.log(
    `sim-gauntlet: ${RUNS} runs/mode · player=${CONFIG_NAME} · draft=${DRAFT} · ramp=${RAMP} · modes=${MODES.join(',')}\n`
  );
  const start = performance.now();
  const summaries: ModeSummary[] = [];

  for (const mode of MODES) {
    const results: RunResult[] = [];
    for (let r = 0; r < RUNS; r++) {
      const runSeed = BASE_SEED + r * 101 + MODES.indexOf(mode) * 1_000_000;
      results.push(runGauntlet(mode, runSeed));
      process.stdout.write(`\r${mode}: ${r + 1}/${RUNS}   `);
    }
    const s = summarize(mode, results);
    summaries.push(s);
    console.log(`\r${mode}: ${s.flawless}/${s.runs} flawless (${pct(s.flawlessRate)})          `);
  }

  const elapsed = (performance.now() - start) / 1000;

  // ---- Report ----
  let md = `# Gauntlet simulation — Can you 6-0?\n\n`;
  md += `${RUNS} runs/mode · player search = **${CONFIG_NAME}** · draft = **${DRAFT}** · easy ramp = **${RAMP}** · `;
  md += `${elapsed.toFixed(0)}s total.\n\n`;
  md += `_Auto-drafted teams (${DRAFT}); real search + the shipped Easy ramp. `;
  md += `FAST understates the STRONG default — read the shape, not the absolute win rate._\n\n`;

  md += `## Outcomes\n\n`;
  md += `| mode | flawless | reached rung (survival) | mean battles/run |\n|---|---|---|---|\n`;
  for (const s of summaries) {
    // survival = fraction of runs still alive entering each rung
    const survival = s.perRung.map(p => (p.played / s.runs));
    md += `| ${s.mode} | **${pct(s.flawlessRate)}** (${s.flawless}/${s.runs}) | ${survival.map(pct).join(' · ')} | ${s.meanBattlesPerRun.toFixed(1)} |\n`;
  }

  md += `\n## Per-rung win rate (of runs that reached it)\n\n`;
  md += `| mode | rung1 | rung2 | rung3 | rung4 | rung5 | rung6 |\n|---|---|---|---|---|---|---|\n`;
  for (const s of summaries) {
    md += `| ${s.mode} | ${s.perRung.map(p => (p.played ? `${pct(p.rate)} (${p.won}/${p.played})` : '—')).join(' | ')} |\n`;
  }

  md += `\n## Where runs died\n\n`;
  md += `| mode | lost r1 | r2 | r3 | r4 | r5 | r6 | flawless |\n|---|---|---|---|---|---|---|---|\n`;
  for (const s of summaries) {
    md += `| ${s.mode} | ${s.eliminatedAt.join(' | ')} | ${s.flawless} |\n`;
  }

  md += `\n## Tera timing (player, p1)\n\n`;
  md += `| mode | Tera'd in | mean Tera turn | mean % through battle |\n|---|---|---|---|\n`;
  for (const s of summaries) {
    md += `| ${s.mode} | ${pct(s.tera.teraRate)} of battles (${s.tera.teraedBattles}/${s.tera.battles}) | turn ${s.tera.meanTeraTurn.toFixed(1)} | ${pct(s.tera.meanTeraFraction)} |\n`;
  }

  md += `\nmean turns/battle: ${summaries.map(s => `${s.mode} ${s.meanTurns.toFixed(0)}`).join(' · ')}\n`;

  writeFileSync(`${LOGS}/gauntlet-sim.md`, md);
  writeFileSync(`${LOGS}/gauntlet-sim.json`, JSON.stringify({config: CONFIG_NAME, draft: DRAFT, ramp: RAMP, runs: RUNS, summaries}, null, 2));
  console.log(`\n${md}`);
  console.log(`wrote ${LOGS}/gauntlet-sim.md and .json`);
}

main();
