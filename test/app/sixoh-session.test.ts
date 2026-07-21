import {describe, expect, it} from 'vitest';
import {opponentPolicy} from '../../src/app/sixoh/session';
import {FAST, STRONG} from '../../src/search/config';
import type {DevParams} from '../../src/app/sixoh/devParams';

const dev: DevParams = {config: STRONG, configName: 'strong'};

describe('opponentPolicy — Easy difficulty ramp', () => {
  it('hard fields the player config full strength on every rung', () => {
    for (let i = 0; i < 6; i++) {
      expect(opponentPolicy('hard', i, dev)).toEqual({kind: 'search', config: STRONG});
    }
  });

  it('easy ramps a decaying blunder rate, easing into a fair mirror', () => {
    const ramp = Array.from({length: 6}, (_, i) => opponentPolicy('easy', i, dev));
    // Weakened early rungs: a FAST searcher that blunders, less each rung.
    expect(ramp[0]).toEqual({kind: 'mix', epsilon: 0.75, config: FAST});
    expect(ramp[1]).toEqual({kind: 'mix', epsilon: 0.55, config: FAST});
    expect(ramp[2]).toEqual({kind: 'mix', epsilon: 0.4, config: FAST});
    expect(ramp[3]).toEqual({kind: 'mix', epsilon: 0.25, config: FAST});
    // Rung 5 (index 4) rarely blunders but at the player's own strength.
    expect(ramp[4]).toEqual({kind: 'mix', epsilon: 0.1, config: STRONG});
    // Final rung: a full, blunder-free mirror.
    expect(ramp[5]).toEqual({kind: 'search', config: STRONG});
    // Blunder rate is monotonically non-increasing.
    const eps = ramp.map(p => (p.kind === 'mix' ? p.epsilon : 0));
    for (let i = 1; i < eps.length; i++) expect(eps[i]).toBeLessThanOrEqual(eps[i - 1]);
  });

  it('easy uses the player config on the ramped-in rungs (fast under config=fast)', () => {
    const fastDev: DevParams = {config: FAST, configName: 'fast'};
    expect(opponentPolicy('easy', 4, fastDev)).toEqual({kind: 'mix', epsilon: 0.1, config: FAST});
    expect(opponentPolicy('easy', 5, fastDev)).toEqual({kind: 'search', config: FAST});
  });
});

describe('opponentPolicy — Gym Leader difficulty ramp', () => {
  it('ramps a decaying blunder rate, LOWER than Easy at every rung (the roster content is weaker, not the AI)', () => {
    const ramp = Array.from({length: 6}, (_, i) => opponentPolicy('gymleader', i, dev));
    const easyRamp = Array.from({length: 6}, (_, i) => opponentPolicy('easy', i, dev));
    const epsilonOf = (p: {kind: string; epsilon?: number}) => (p.kind === 'mix' ? p.epsilon! : 0);
    // Counterintuitive but tuning-verified: a heavily-blundering AI on the
    // (intentionally weaker) gym leader rosters was far too easy, so Gym
    // Leader's curve blunders LESS than Easy's at every rung.
    for (let i = 0; i < 6; i++) expect(epsilonOf(ramp[i])).toBeLessThanOrEqual(epsilonOf(easyRamp[i]));
    // Blunder rate is monotonically non-increasing.
    const eps = ramp.map(epsilonOf);
    for (let i = 1; i < eps.length; i++) expect(eps[i]).toBeLessThanOrEqual(eps[i - 1]);
    // Early rungs search shallowly under the blunders; the top rungs mirror
    // the player's own config (full strength, no blunders left by rung 5).
    expect(ramp[0]).toEqual({kind: 'mix', epsilon: expect.any(Number), config: FAST});
    expect(ramp[4]).toEqual({kind: 'search', config: STRONG});
    expect(ramp[5]).toEqual({kind: 'search', config: STRONG});
  });
});
