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

  it('easy ramps: random -> FAST -> player config across the six rungs', () => {
    const kinds = Array.from({length: 6}, (_, i) => opponentPolicy('easy', i, dev));
    expect(kinds[0]).toEqual({kind: 'random'});
    expect(kinds[1]).toEqual({kind: 'random'});
    expect(kinds[2]).toEqual({kind: 'search', config: FAST});
    expect(kinds[3]).toEqual({kind: 'search', config: FAST});
    expect(kinds[4]).toEqual({kind: 'search', config: STRONG});
    expect(kinds[5]).toEqual({kind: 'search', config: STRONG});
  });

  it('easy top rungs mirror the player config (fair fight, fast under config=fast)', () => {
    const fastDev: DevParams = {config: FAST, configName: 'fast'};
    expect(opponentPolicy('easy', 5, fastDev)).toEqual({kind: 'search', config: FAST});
  });
});
