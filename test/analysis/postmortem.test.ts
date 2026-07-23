import {describe, expect, it} from 'vitest';
import {gen9} from '../../src/data/gen';
import {buildPostMortem, type PlayedBattle} from '../../src/analysis/postmortem';
import type {BattleResult} from '../../src/search/runner';
import type {BattleStats} from '../../src/search/stats';
import {fixtureTeams} from '../engine/helpers';

const gen = gen9();
const [userTeam, oppTeam] = fixtureTeams();
const opponents = Array.from({length: 6}, (_, i) => ({name: `Opponent ${i + 1}`, sets: oppTeam}));

function battle(
  winner: 0 | 1 | null,
  opponentIndex: number,
  stats?: Partial<BattleStats>,
  protocolLog?: string[]
): PlayedBattle {
  const result: BattleResult = {
    winner, turns: 30, decisions: 30, nodes: 0, msSearch: 0, msTable: 0,
    msPerDecision: {mean: 0, p50: 0, p95: 0}, nodesPerDecision: 0,
    stats: {
      faints: [], damageDealtFrac: [{}, {}], speedRace: {fasterCounts: [10, 20], ties: 0},
      ...stats,
    },
    ...(protocolLog ? {protocolLog} : {}),
  };
  return {opponentIndex, result};
}

// Your last mon (Corviknight) goes down to a critical Extreme Speed. Species
// are deliberately NOT drawn from fixtureTeams — this exercises findBiggestHit
// purely from the log, independent of the real-team calc/threatFacts path.
const FINISHING_BLOW_LOG = [
  '|switch|p1a: Corviknight|Corviknight|100/100',
  '|switch|p2a: Dragonite|Dragonite, M|100/100',
  '|turn|20',
  '|move|p2a: Dragonite|Extreme Speed|p1a: Corviknight',
  '|-crit|p1a: Corviknight',
  '|-damage|p1a: Corviknight|0 fnt',
  '|faint|p1a: Corviknight',
  '|win|Foe',
];

// Your Kingambit lands a huge, super-effective (but non-lethal) hit.
const BIG_HIT_LOG = [
  '|switch|p1a: Kingambit|Kingambit, M|100/100',
  '|switch|p2a: Ting-Lu|Ting-Lu|100/100',
  '|turn|1',
  '|move|p1a: Kingambit|Kowtow Cleave|p2a: Ting-Lu',
  '|-supereffective|p2a: Ting-Lu',
  '|-damage|p2a: Ting-Lu|5/100',
];

describe('buildPostMortem (eliminated)', () => {
  it('leads with the workhorse read, then the earliest faint, up to 3 lines', () => {
    const battles = [
      battle(0, 0),
      battle(1, 1, {
        faints: [
          {side: 0, speciesId: 'darkrai', turn: 4, causeSpeciesId: 'gliscor', causeKind: 'move'},
          {side: 0, speciesId: 'kingambit', turn: 12, causeKind: 'residual'},
        ],
        damageDealtFrac: [{darkrai: 0.8}, {gliscor: 2.1, tinglu: 0.9}],
      }),
    ];
    const pm = buildPostMortem(gen, userTeam, opponents, battles, 'eliminated');
    expect(pm.headline).toBe('Eliminated in game 2 by Opponent 2.');
    expect(pm.record).toBe('1–1');
    // No protocolLog on this battle -> no finishing-blow line; just the two
    // stats-driven reads (workhorse, earliest faint).
    expect(pm.lines.length).toBe(2);
    expect(pm.lines[0]).toMatch(/Gliscor/);
    expect(pm.lines[1]).toMatch(/Darkrai was first to go down \(turn ~4 to Gliscor\)/);
  });

  it('leads with the finishing blow, mined from the actual battle log, when one is present', () => {
    const battles = [
      battle(0, 0),
      battle(
        1,
        1,
        {
          faints: [{side: 0, speciesId: 'darkrai', turn: 4, causeSpeciesId: 'gliscor', causeKind: 'move'}],
          damageDealtFrac: [{darkrai: 0.8}, {gliscor: 2.1, tinglu: 0.9}],
        },
        FINISHING_BLOW_LOG
      ),
    ];
    const pm = buildPostMortem(gen, userTeam, opponents, battles, 'eliminated');
    expect(pm.lines[0]).toMatch(/Dragonite's Extreme Speed sealed it \(a critical hit\): 100% and your last mon went down\./);
    // The kept workhorse + earliest-faint reads still follow.
    expect(pm.lines.length).toBe(3);
  });

  it('reports a stall-out distinctly from a KO elimination', () => {
    const pm = buildPostMortem(gen, userTeam, opponents, [battle(null, 0)], 'eliminated');
    expect(pm.headline).toMatch(/^Stalled out in game 1/);
  });
});

describe('buildPostMortem (flawless)', () => {
  it('produces MVP and weakest-link lines from folded stats', () => {
    const battles = Array.from({length: 6}, (_, i) =>
      battle(0, i, {
        damageDealtFrac: [{kingambit: 1.5, darkrai: 0.5}, {}],
        faints: i < 4 ? [{side: 0, speciesId: 'glimmora', turn: 8, causeKind: 'move' as const}] : [],
      })
    );
    const pm = buildPostMortem(gen, userTeam, opponents, battles, 'flawless');
    expect(pm.headline).toBe('Flawless.');
    expect(pm.record).toBe('6–0');
    // No protocolLog on any battle -> no biggest-hit-of-the-run line.
    expect(pm.lines.length).toBe(2);
    expect(pm.lines[0]).toMatch(/Kingambit was the real MVP: 75% of the damage across all six wins/);
    expect(pm.lines[1]).toMatch(/Glimmora took the L in 4 of 6 games/);
  });

  it('includes the biggest hit of the run, mined across every battle log', () => {
    const battles = [
      battle(0, 0, {damageDealtFrac: [{kingambit: 1.5, darkrai: 0.5}, {}]}, BIG_HIT_LOG),
      ...Array.from({length: 5}, (_, i) => battle(0, i + 1, {damageDealtFrac: [{kingambit: 1.5, darkrai: 0.5}, {}]})),
    ];
    const pm = buildPostMortem(gen, userTeam, opponents, battles, 'flawless');
    expect(pm.lines.some(line => /Kingambit's Kowtow Cleave took 95% off Ting-Lu in one shot \(super effective\)/.test(line))).toBe(true);
    // MVP + biggest-hit; no weakest-link (no faint data given in this fixture).
    expect(pm.lines.length).toBe(2);
  });
});
