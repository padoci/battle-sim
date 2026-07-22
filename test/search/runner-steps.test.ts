import {describe, expect, it} from 'vitest';
import {gen9} from '../../src/data/gen';
import {seedFromInts} from '../../src/engine/rng';
import {FAST} from '../../src/search/config';
import {runBattle, runBattleSteps, type BattleJob, type BattleStep} from '../../src/search/runner';
import {fixtureTeams} from '../engine/helpers';

const gen = gen9();
const [team1, team2] = fixtureTeams();

function job(overrides: Partial<BattleJob> = {}): BattleJob {
  return {
    teams: [team1, team2],
    battleSeed: seedFromInts(10, 20, 30, 40),
    searchSeed: 777,
    policies: [
      {kind: 'search', config: FAST},
      {kind: 'search', config: FAST},
    ],
    collectLog: true,
    maxTurns: 60,
    ...overrides,
  };
}

function drain(j: BattleJob): {steps: BattleStep[]; result: ReturnType<typeof runBattle>} {
  const generator = runBattleSteps(gen, j);
  const steps: BattleStep[] = [];
  let next = generator.next();
  while (!next.done) {
    steps.push(next.value);
    next = generator.next();
  }
  return {steps, result: next.value};
}

describe('runBattleSteps (the streaming substrate)', () => {
  it('drained generator ≡ runBattle on the same job (winner/turns/log)', () => {
    const {result: streamed} = drain(job());
    const direct = runBattle(gen, job());
    expect(streamed.winner).toBe(direct.winner);
    expect(streamed.turns).toBe(direct.turns);
    expect(streamed.decisions).toBe(direct.decisions);
    // |t:| lines carry wall-clock seconds — the one legitimately
    // non-deterministic protocol line between two runs of the same seeds.
    const noClock = (log?: string[]) => log?.filter(line => !line.startsWith('|t:|'));
    expect(noClock(streamed.protocolLog)).toEqual(noClock(direct.protocolLog));
  });

  it('concatenated step chunks reconstruct protocolLog exactly, in order', () => {
    const {steps, result} = drain(job());
    expect(steps.length).toBeGreaterThan(1);
    // Step 0 is the prelude (leads placed before any search decision).
    expect(steps[0].decisions).toBe(0);
    expect(steps[0].logLines.some(line => line.startsWith('|switch|'))).toBe(true);
    // Decisions count strictly upward.
    for (let i = 1; i < steps.length; i++) expect(steps[i].decisions).toBe(i);
    expect(steps.flatMap(step => step.logLines)).toEqual(result.protocolLog);
  });
});
