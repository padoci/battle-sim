import {describe, expect, it} from 'vitest';
import {
  createBattle,
  isOver,
  makeJointChoice,
  restore,
  snapshot,
  winner,
} from '../../src/engine/battle';
import {legalActions, toChoice} from '../../src/engine/actions';
import {makeRng, pick, seedFromInts} from '../../src/engine/rng';
import {fixtureTeams} from './helpers';

const SEED = seedFromInts(1, 2, 3, 4);

function runRandomBattle(rngSeed: number) {
  const [team1, team2] = fixtureTeams();
  const battle = createBattle({p1: {team: team1}, p2: {team: team2}, seed: SEED});
  const rng = makeRng(rngSeed);
  let choices = 0;
  while (!isOver(battle) && choices < 500) {
    const c1 = toChoice(pick(rng, legalActions(battle, 0)));
    const c2 = toChoice(pick(rng, legalActions(battle, 1)));
    makeJointChoice(battle, c1, c2);
    choices++;
  }
  return {battle, choices};
}

describe('battle wrapper', () => {
  it('starts a fixture-team battle past team preview into turn 1', () => {
    const [team1, team2] = fixtureTeams();
    const battle = createBattle({p1: {team: team1}, p2: {team: team2}, seed: SEED});
    expect(battle.turn).toBe(1);
    expect(battle.sides[0].pokemon).toHaveLength(6);
    expect(legalActions(battle, 0).length).toBeGreaterThan(0);
  });

  it('completes a random battle with a winner', () => {
    const {battle, choices} = runRandomBattle(99);
    expect(choices).toBeLessThan(500);
    expect(isOver(battle)).toBe(true);
    expect([0, 1]).toContain(winner(battle));
  });

  it('is deterministic: same seeds -> identical outcome', () => {
    const a = runRandomBattle(7);
    const b = runRandomBattle(7);
    expect(winner(a.battle)).toBe(winner(b.battle));
    expect(a.battle.turn).toBe(b.battle.turn);
    expect(a.battle.log.length).toBe(b.battle.log.length);
    expect(a.choices).toBe(b.choices);
  });

  it('winner() maps the winning name to a side index', () => {
    const {battle} = runRandomBattle(123);
    const w = winner(battle)!;
    expect(battle.winner).toBe(battle.sides[w].name);
  });
});

describe('snapshot / restore', () => {
  it('supports independent diverging branches while the original stays intact', () => {
    const [team1, team2] = fixtureTeams();
    const battle = createBattle({p1: {team: team1}, p2: {team: team2}, seed: SEED});
    // Advance a few turns for a non-trivial state.
    const rng = makeRng(5);
    for (let i = 0; i < 5 && !isOver(battle); i++) {
      makeJointChoice(
        battle,
        toChoice(pick(rng, legalActions(battle, 0))),
        toChoice(pick(rng, legalActions(battle, 1)))
      );
    }
    const turnBefore = battle.turn;
    const snap = snapshot(battle);

    const branchA = restore(snap);
    const actionsA = legalActions(branchA, 0).filter(a => a.kind === 'move');
    makeJointChoice(branchA, toChoice(actionsA[0]), 'default');

    const branchB = restore(snap);
    const actionsB = legalActions(branchB, 0);
    makeJointChoice(branchB, toChoice(actionsB[actionsB.length - 1]), 'default');

    // Branches advanced; original and a third restore did not.
    expect(branchA.turn).toBeGreaterThanOrEqual(turnBefore);
    expect(battle.turn).toBe(turnBefore);
    expect(restore(snap).turn).toBe(turnBefore);
    // Different actions produced different battles.
    expect(branchA.log.join('\n')).not.toBe(branchB.log.join('\n'));
  });

  it('restored battles preserve the PRNG seed', () => {
    const [team1, team2] = fixtureTeams();
    const battle = createBattle({p1: {team: team1}, p2: {team: team2}, seed: SEED});
    const snap = snapshot(battle);
    expect(restore(snap).prng.getSeed()).toEqual(battle.prng.getSeed());
  });

  it('regression: the snapshot log is stripped, not shared by reference', () => {
    const [team1, team2] = fixtureTeams();
    const battle = createBattle({p1: {team: team1}, p2: {team: team2}, seed: SEED});
    const snap = snapshot(battle) as unknown as {log: string[]};
    expect(snap.log).toEqual([]);

    const branch = restore(snap as never);
    makeJointChoice(branch, 'default', 'default');
    // Advancing a branch must not grow the snapshot's (or original's) log.
    expect(snap.log).toEqual([]);
    expect(branch.log.length).toBeGreaterThan(0);
  });
});
