import {describe, expect, it} from 'vitest';
import {gen9} from '../../src/data/gen';
import {buildPostMortem, type PlayedBattle} from '../../src/analysis/postmortem';
import type {BattleResult} from '../../src/search/runner';
import type {BattleStats} from '../../src/search/stats';
import {fixtureTeams} from '../engine/helpers';

const gen = gen9();
const [userTeam, oppTeam] = fixtureTeams();
const opponents = Array.from({length: 6}, (_, i) => ({name: `Opponent ${i + 1}`, sets: oppTeam}));

function battle(winner: 0 | 1 | null, opponentIndex: number, stats?: Partial<BattleStats>): PlayedBattle {
  const result: BattleResult = {
    winner, turns: 30, decisions: 30, nodes: 0, msSearch: 0, msTable: 0,
    msPerDecision: {mean: 0, p50: 0, p95: 0}, nodesPerDecision: 0,
    stats: {
      faints: [], damageDealtFrac: [{}, {}], speedRace: {fasterCounts: [10, 20], ties: 0},
      ...stats,
    },
  };
  return {opponentIndex, result};
}

describe('buildPostMortem (eliminated)', () => {
  it('produces <=2 reads referencing the workhorse and earliest faint, with evidence', () => {
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
    expect(pm.reads.length).toBeGreaterThanOrEqual(1);
    expect(pm.reads.length).toBeLessThanOrEqual(2);
    expect(pm.reads[0].sentence).toMatch(/Gliscor/);
    expect(pm.reads[0].evidence.length).toBeGreaterThan(0);
    const faintRead = pm.reads[1];
    expect(faintRead.sentence).toMatch(/Darkrai went down first \(turn ~4 to Gliscor\)/);
  });

  it('reports a stall-out distinctly from a KO elimination', () => {
    const pm = buildPostMortem(gen, userTeam, opponents, [battle(null, 0)], 'eliminated');
    expect(pm.headline).toMatch(/^Stalled out in game 1/);
  });
});

describe('buildPostMortem (flawless)', () => {
  it('produces MVP and weakest-link reads from folded stats', () => {
    const battles = Array.from({length: 6}, (_, i) =>
      battle(0, i, {
        damageDealtFrac: [{kingambit: 1.5, darkrai: 0.5}, {}],
        faints: i < 4 ? [{side: 0, speciesId: 'glimmora', turn: 8, causeKind: 'move' as const}] : [],
      })
    );
    const pm = buildPostMortem(gen, userTeam, opponents, battles, 'flawless');
    expect(pm.headline).toBe('Flawless.');
    expect(pm.record).toBe('6–0');
    expect(pm.reads[0].sentence).toMatch(/Kingambit carried the run: 75% of all damage dealt/);
    expect(pm.reads[1].sentence).toMatch(/Glimmora fainted in 4 of 6 games/);
    for (const read of pm.reads) expect(read.evidence.length).toBeGreaterThan(0);
  });
});
