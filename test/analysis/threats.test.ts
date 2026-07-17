import {describe, expect, it} from 'vitest';
import {gen9} from '../../src/data/gen';
import {buildCalcTable} from '../../src/engine/calc/table';
import {bestAnswer, bestThreat, buildPairingContext, threatFacts} from '../../src/analysis/threats';
import {makeSet} from '../engine/helpers';

const gen = gen9();

// Darkrai (fast special attacker, Ice Beam) vs Gliscor (4x ice-weak) + Blissey.
const userTeam = [
  makeSet('Gliscor', ['Earthquake', 'Knock Off', 'Protect', 'Swords Dance'], {
    ability: 'Poison Heal',
    item: 'Toxic Orb',
    nature: 'Jolly',
    evs: {hp: 244, atk: 0, def: 0, spa: 0, spd: 244, spe: 20},
  }),
  makeSet('Blissey', ['Seismic Toss', 'Soft-Boiled'], {
    ability: 'Natural Cure',
    nature: 'Calm',
    evs: {hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0},
  }),
];
const opponentTeam = [
  makeSet('Darkrai', ['Dark Pulse', 'Ice Beam', 'Focus Blast', 'Sludge Bomb'], {
    ability: 'Bad Dreams',
    nature: 'Timid',
    evs: {hp: 0, atk: 0, def: 0, spa: 252, spd: 4, spe: 252},
  }),
];

const table = buildCalcTable(gen, [userTeam, opponentTeam]);
const ctx = buildPairingContext(gen, userTeam, opponentTeam, table);

describe('bestThreat', () => {
  it('picks Ice Beam vs Gliscor (4x) and reports OHKO facts', () => {
    const gliscor = ctx.state.sides[0].mons[0];
    const darkrai = ctx.state.sides[1].mons[0];
    const threat = bestThreat(ctx, 1, darkrai, gliscor)!;
    expect(threat.moveName).toBe('Ice Beam');
    expect(threat.koProb).toBe(1);
    expect(threat.koTurns).toBe(1);
    expect(threat.fracRange[0]).toBeGreaterThan(1);
  });

  it('reports multi-hit facts vs a wall (Blissey)', () => {
    const blissey = ctx.state.sides[0].mons[1];
    const darkrai = ctx.state.sides[1].mons[0];
    const threat = bestThreat(ctx, 1, darkrai, blissey)!;
    expect(threat.koProb).toBe(0);
    expect(threat.koTurns).toBeGreaterThan(2);
  });

  it('returns undefined when the attacker has no damaging moves', () => {
    const passive = [makeSet('Blissey', ['Soft-Boiled', 'Protect'], {nature: 'Calm'})];
    const table2 = buildCalcTable(gen, [passive, opponentTeam]);
    const ctx2 = buildPairingContext(gen, passive, opponentTeam, table2);
    expect(bestThreat(ctx2, 0, ctx2.state.sides[0].mons[0], ctx2.state.sides[1].mons[0])).toBeUndefined();
  });
});

describe('threatFacts', () => {
  it('reports speed dominance and the scariest line with mono evidence', () => {
    const darkrai = ctx.state.sides[1].mons[0];
    const facts = threatFacts(ctx, darkrai);
    const speedFact = facts.find(f => f.kind === 'outspeeds-team');
    expect(speedFact).toBeDefined();
    expect(speedFact!.evidence).toMatch(/outspeeds all 2/);
    const koFact = facts.find(f => f.kind === 'ohko');
    expect(koFact).toBeDefined();
    expect(koFact!.evidence).toMatch(/Ice Beam vs Gliscor: \d+.*%.*OHKO/);
  });
});

describe('bestAnswer', () => {
  it('prefers the mon that takes little and hits back', () => {
    const darkrai = ctx.state.sides[1].mons[0];
    const answer = bestAnswer(ctx, darkrai)!;
    // Blissey walls Darkrai completely; Gliscor gets OHKOed.
    expect(answer.species).toBe('Blissey');
  });
});
