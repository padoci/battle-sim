import {bench, describe} from 'vitest';
import {gen9} from '../../src/data/gen';
import {createBattle, makeJointChoice, restore, snapshot} from '../../src/engine/battle';
import {legalActions, toChoice} from '../../src/engine/actions';
import {extractState} from '../../src/engine/snapshot';
import {buildCalcTable} from '../../src/engine/calc/table';
import {evaluate} from '../../src/engine/eval';
import {makeRng, pick, seedFromInts} from '../../src/engine/rng';
import {fixtureTeams} from './helpers';

/**
 * Pre-measurement for the Stage 2 gate (search spec §5): the cost of one
 * search node is roughly restore + makeChoices (+ extract + evaluate).
 * Run with `npx vitest bench` — not part of `npm test`.
 */
const gen = gen9();
const [team1, team2] = fixtureTeams();

function midGameBattle() {
  const battle = createBattle({p1: {team: team1}, p2: {team: team2}, seed: seedFromInts(1, 2, 3, 4)});
  const rng = makeRng(42);
  for (let i = 0; i < 8 && !battle.ended; i++) {
    makeJointChoice(
      battle,
      toChoice(pick(rng, legalActions(battle, 0))),
      toChoice(pick(rng, legalActions(battle, 1)))
    );
  }
  return battle;
}

const battle = midGameBattle();
const snap = snapshot(battle);
const table = buildCalcTable(gen, [team1, team2]);
const state = extractState(battle);

describe('transition costs (per search node)', () => {
  bench('snapshot (serializeBattle + log strip)', () => {
    snapshot(battle);
  });

  bench('restore (deserializeBattle)', () => {
    restore(snap);
  });

  bench('restore + legalActions + makeChoices (one search node)', () => {
    const branch = restore(snap);
    makeJointChoice(
      branch,
      toChoice(legalActions(branch, 0)[0]),
      toChoice(legalActions(branch, 1)[0])
    );
  });

  bench('restore + step + extract + evaluate (full node)', () => {
    const branch = restore(snap);
    makeJointChoice(
      branch,
      toChoice(legalActions(branch, 0)[0]),
      toChoice(legalActions(branch, 1)[0])
    );
    evaluate(extractState(branch), table, 0);
  });
});

describe('per-battle and per-eval costs', () => {
  bench('buildCalcTable (once per battle)', () => {
    buildCalcTable(gen, [team1, team2]);
  });

  bench('extractState', () => {
    extractState(battle);
  });

  bench('evaluate (on cached state + table)', () => {
    evaluate(state, table, 0);
  });
});
