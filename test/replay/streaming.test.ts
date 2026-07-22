import {describe, expect, it} from 'vitest';
import {gen9} from '../../src/data/gen';
import {seedFromInts} from '../../src/engine/rng';
import {FAST} from '../../src/search/config';
import {runBattleSteps, type BattleJob} from '../../src/search/runner';
import {parseProtocol} from '../../src/replay/parse';
import {toBeats} from '../../src/replay/pace';
import {fixtureTeams} from '../engine/helpers';

/**
 * The invariant the whole streaming design leans on: parsing a PREFIX of the
 * protocol log cut at any decision boundary yields exactly a prefix of the
 * full battle's beats. If this holds, feeding the growing log through
 * parse+toBeats per chunk can never rewrite beats the player already
 * watched (|split| trios and a move's consequence lines never straddle a
 * decision, so nothing gets re-grouped retroactively).
 */
describe('streamed beat prefix-stability', () => {
  it('every decision-boundary prefix parses to a prefix of the full beat list', () => {
    const gen = gen9();
    const [team1, team2] = fixtureTeams();
    const job: BattleJob = {
      teams: [team1, team2],
      battleSeed: seedFromInts(4, 8, 15, 16),
      searchSeed: 2323,
      policies: [
        {kind: 'search', config: FAST},
        {kind: 'search', config: FAST},
      ],
      collectLog: true,
      maxTurns: 40,
    };

    const chunks: string[][] = [];
    const generator = runBattleSteps(gen, job);
    let next = generator.next();
    while (!next.done) {
      chunks.push(next.value.logLines);
      next = generator.next();
    }
    const fullLog = chunks.flat();
    const names: [string, string] = ['Your', 'The opposing'];
    const fullBeats = toBeats(parseProtocol(fullLog, names));
    expect(fullBeats.length).toBeGreaterThan(5);

    const accumulated: string[] = [];
    for (const chunk of chunks) {
      accumulated.push(...chunk);
      const prefixBeats = toBeats(parseProtocol(accumulated, names));
      expect(prefixBeats.length).toBeLessThanOrEqual(fullBeats.length);
      // Deep prefix equality: nothing already emitted may differ from the
      // final battle's version of the same beat.
      expect(prefixBeats).toEqual(fullBeats.slice(0, prefixBeats.length));
    }
  });
});
