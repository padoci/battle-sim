import {describe, expect, it} from 'vitest';
import {opponentPolicy} from '../../src/app/sixoh/session';
import {FAST, STRONG} from '../../src/search/config';
import type {DevParams} from '../../src/app/sixoh/devParams';

const dev: DevParams = {config: STRONG, configName: 'strong'};

describe('opponentPolicy — Easy difficulty ramp', () => {
  it('normal/hard field the player config full strength on every rung', () => {
    for (const mode of ['normal', 'hard'] as const) {
      for (let i = 0; i < 6; i++) {
        expect(opponentPolicy(mode, i, dev)).toEqual({kind: 'search', config: STRONG});
      }
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
