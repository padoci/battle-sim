import {describe, expect, it} from 'vitest';
import {gen9} from '../../src/data/gen';
import {seedFromInts} from '../../src/engine/rng';
import {fasterSide} from '../../src/engine/eval';
import {runBattle, type BattleJob} from '../../src/search/runner';
import {FAST} from '../../src/search/config';
import {fixtureTeams, makeSet} from '../engine/helpers';
import type {BattleState, MonState, SideState} from '../../src/engine/snapshot';

const gen = gen9();

describe('fasterSide', () => {
  function state(speA: number, speB: number, trickRoom = false, tailwindA = false): BattleState {
    const mon = (spe: number): MonState => ({
      slot: 0, speciesId: 'x', hp: 100, maxhp: 100, fainted: false,
      boosts: {atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0},
      status: '', volatiles: [], itemId: '', abilityId: '', teraType: '',
      terastallized: false, spe, moveIds: [], isActive: true,
    });
    const side = (spe: number, tailwind: boolean): SideState => ({
      mons: [mon(spe)], activeIndex: 0,
      hazards: {stealthrock: false, spikes: 0, toxicspikes: 0, stickyweb: false},
      screens: {reflect: false, lightscreen: false, auroraveil: false},
      tailwind, safeguard: false, teraUsed: false,
    });
    return {sides: [side(speA, tailwindA), side(speB, false)], weather: '', terrain: '', trickRoom, turn: 1};
  }

  it('picks the faster side and reports ties', () => {
    expect(fasterSide(state(200, 100), 0)).toBe(0);
    expect(fasterSide(state(100, 200), 0)).toBe(1);
    expect(fasterSide(state(100, 100), 0)).toBe('tie');
  });

  it('inverts under trick room and respects tailwind', () => {
    expect(fasterSide(state(100, 200, true), 0)).toBe(0);
    expect(fasterSide(state(150, 200, false, true), 0)).toBe(0); // 150x2 > 200
  });

  it('is pov-consistent', () => {
    expect(fasterSide(state(200, 100), 1)).toBe(0);
  });
});

describe('collectStats instrumentation', () => {
  it('records faints with move attribution in a scripted lethal matchup', () => {
    // Level-5 Chansey dies immediately to Gholdengo's Make It Rain.
    const job: BattleJob = {
      teams: [
        [
          makeSet('Chansey', ['Seismic Toss'], {ability: 'Natural Cure', level: 5}),
          makeSet('Blissey', ['Seismic Toss', 'Soft-Boiled'], {ability: 'Natural Cure'}),
        ],
        [makeSet('Gholdengo', ['Make It Rain', 'Shadow Ball'], {ability: 'Good as Gold'})],
      ],
      battleSeed: seedFromInts(3, 3, 3, 3),
      searchSeed: 5,
      policies: [{kind: 'random'}, {kind: 'random'}],
      maxTurns: 50,
      collectStats: true,
    };
    const result = runBattle(gen, job);
    expect(result.stats).toBeDefined();
    const chanseyFaint = result.stats!.faints.find(f => f.speciesId === 'chansey');
    expect(chanseyFaint).toBeDefined();
    expect(chanseyFaint!.side).toBe(0);
    expect(chanseyFaint!.causeKind).toBe('move');
    expect(chanseyFaint!.causeSpeciesId).toBe('gholdengo');
    // Gholdengo dealt real damage.
    expect(result.stats!.damageDealtFrac[1]['gholdengo']).toBeGreaterThan(0.5);
  });

  it('tallies the speed race and works alongside search policies', () => {
    const [team1, team2] = fixtureTeams();
    const job: BattleJob = {
      teams: [team1, team2],
      battleSeed: seedFromInts(6, 6, 6, 6),
      searchSeed: 9,
      policies: [
        {kind: 'search', config: FAST},
        {kind: 'search', config: FAST},
      ],
      maxTurns: 100,
      collectStats: true,
    };
    const result = runBattle(gen, job);
    const race = result.stats!.speedRace;
    expect(race.fasterCounts[0] + race.fasterCounts[1] + race.ties).toBeGreaterThan(5);
    expect(result.stats!.faints.length).toBeGreaterThan(0);
    // Stats collection must not alter the battle outcome vs a bare run.
    const bare = runBattle(gen, {...job, collectStats: false});
    expect(bare.winner).toBe(result.winner);
    expect(bare.turns).toBe(result.turns);
  });
});
