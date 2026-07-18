import {describe, expect, it} from 'vitest';
import {createBattle, makeJointChoice, reseed, restore, snapshot} from '../../src/engine/battle';
import {forkSeed} from '../../src/search/fork';
import {seedFromInts} from '../../src/engine/rng';
import {fixtureTeams} from '../engine/helpers';

describe('forkSeed', () => {
  it('is deterministic and distinct across cells', () => {
    expect(forkSeed(1, 5, 2, 3, 0)).toEqual(forkSeed(1, 5, 2, 3, 0));
    const seeds = new Set<string>();
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        for (let k = 0; k < 10; k++) seeds.add(String(forkSeed(42, 7, i, j, k)));
      }
    }
    expect(seeds.size).toBe(8 * 8 * 10);
  });
});

describe('clairvoyance regression (search branches must not replay the game RNG)', () => {
  function freshBattle() {
    const [team1, team2] = fixtureTeams();
    return createBattle({p1: {team: team1}, p2: {team: team2}, seed: seedFromInts(1, 2, 3, 4)});
  }

  it('restore alone preserves the live PRNG seed (the hazard this guards)', () => {
    const battle = freshBattle();
    const branch = restore(snapshot(battle));
    expect(branch.prng.getSeed()).toEqual(battle.prng.getSeed());
  });

  it('reseed changes the branch PRNG away from the live stream', () => {
    const battle = freshBattle();
    const branch = restore(snapshot(battle));
    reseed(branch, forkSeed(1, battle.turn, 0, 0));
    expect(branch.prng.getSeed()).not.toEqual(battle.prng.getSeed());
  });

  it('same fork seed -> byte-identical branch outcomes; different seeds can diverge', () => {
    const battle = freshBattle();
    const snap = snapshot(battle);

    const run = (cellSeed: ReturnType<typeof forkSeed>) => {
      const branch = restore(snap);
      reseed(branch, cellSeed);
      // A multi-roll turn: both actives attack.
      makeJointChoice(branch, 'move 1', 'move 1');
      // Drop `|t:|` wall-clock lines: they embed real time, so two identical
      // branches straddling a second boundary would spuriously differ (flake
      // under CI load). Everything game-relevant is timestamp-free.
      return branch.log.filter(line => !line.startsWith('|t:|')).join('\n');
    };

    expect(run(forkSeed(7, 1, 0, 0))).toBe(run(forkSeed(7, 1, 0, 0)));

    // Across many fork seeds, at least one outcome differs (damage rolls).
    const outcomes = new Set<string>();
    for (let k = 0; k < 12; k++) outcomes.add(run(forkSeed(7, 1, 0, 0, k)));
    expect(outcomes.size).toBeGreaterThan(1);
  });
});
