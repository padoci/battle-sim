import {describe, expect, it} from 'vitest';
import {createBattle, makeJointChoice} from '../../src/engine/battle';
import {extractState} from '../../src/engine/snapshot';
import {seedFromInts} from '../../src/engine/rng';
import {makeSet} from './helpers';

/**
 * Scripted battle producing a rich state: hazards, tailwind, toxic, boosts,
 * substitute, (probabilistic but seed-deterministic) leech seed, and a Tera.
 */
function scriptedBattle() {
  const battle = createBattle({
    p1: {
      team: [
        makeSet('Clodsire', ['Stealth Rock', 'Toxic', 'Curse', 'Recover'], {
          ability: 'Water Absorb',
          evs: {hp: 252, atk: 4, def: 252, spa: 0, spd: 0, spe: 0},
        }),
        makeSet('Blissey', ['Seismic Toss', 'Soft-Boiled'], {ability: 'Natural Cure'}),
      ],
    },
    p2: {
      team: [
        makeSet('Whimsicott', ['Leech Seed', 'Substitute', 'Tailwind', 'Moonblast'], {
          ability: 'Prankster',
        }),
        makeSet('Kingambit', ['Sucker Punch', 'Iron Head'], {ability: 'Supreme Overlord'}),
      ],
    },
    seed: seedFromInts(11, 22, 33, 44),
  });
  makeJointChoice(battle, 'move 1', 'move 3'); // Stealth Rock | Tailwind
  makeJointChoice(battle, 'move 2', 'move 1'); // Toxic | Leech Seed
  makeJointChoice(battle, 'move 3', 'move 2 terastallize'); // Curse | Substitute + Tera
  return battle;
}

describe('extractState', () => {
  it('mirrors the live battle field-by-field after a scripted game', () => {
    const battle = scriptedBattle();
    const state = extractState(battle);

    for (const i of [0, 1] as const) {
      const side = battle.sides[i];
      const extracted = state.sides[i];
      expect(extracted.mons).toHaveLength(side.pokemon.length);
      for (const [j, pokemon] of side.pokemon.entries()) {
        const mon = extracted.mons[j];
        expect(mon.speciesId).toBe(pokemon.species.id);
        expect(mon.hp).toBe(pokemon.hp);
        expect(mon.maxhp).toBe(pokemon.maxhp);
        expect(mon.fainted).toBe(pokemon.fainted);
        expect(mon.boosts).toEqual({...pokemon.boosts});
        expect(mon.status).toBe(pokemon.status);
        expect(mon.volatiles).toEqual(Object.keys(pokemon.volatiles));
        expect(mon.itemId).toBe(pokemon.item);
        expect(mon.abilityId).toBe(pokemon.ability);
        expect(mon.terastallized).toBe(!!pokemon.terastallized);
        expect(mon.spe).toBe(pokemon.storedStats.spe);
        expect(mon.moveIds).toEqual(pokemon.moveSlots.map(m => m.id));
        expect(mon.isActive).toBe(pokemon.isActive);
      }
      expect(extracted.activeIndex).toBe(side.pokemon.findIndex(p => p.isActive));
    }
    expect(state.turn).toBe(battle.turn);
  });

  it('captures the scripted effects', () => {
    const battle = scriptedBattle();
    const state = extractState(battle);
    const [p1, p2] = state.sides;

    // Stealth Rock landed on P2's side; P2 owns Tailwind.
    expect(p2.hazards.stealthrock).toBe(true);
    expect(p1.hazards.stealthrock).toBe(false);
    expect(p2.tailwind).toBe(true);

    // Toxic on Whimsicott (Clodsire is Poison-type: never misses).
    expect(p2.mons[0].status).toBe('tox');

    // Curse boosts on Clodsire.
    expect(p1.mons[0].boosts.atk).toBe(1);
    expect(p1.mons[0].boosts.def).toBe(1);
    expect(p1.mons[0].boosts.spe).toBe(-1);

    // Substitute volatile + Tera on Whimsicott; P2's Tera is spent, P1's isn't.
    expect(p2.mons[0].volatiles).toContain('substitute');
    expect(p2.mons[0].terastallized).toBe(true);
    expect(p2.teraUsed).toBe(true);
    expect(p1.teraUsed).toBe(false);

    // Leech Seed is 90% accurate — assert extraction parity either way,
    // deterministically per seed (this seed lands it).
    expect(p1.mons[0].volatiles.includes('leechseed')).toBe(
      'leechseed' in battle.sides[0].pokemon[0].volatiles
    );
  });

  it('is detached: advancing the battle does not mutate the extracted state', () => {
    const battle = scriptedBattle();
    const state = extractState(battle);
    const hpBefore = state.sides[1].mons[0].hp;
    const turnBefore = state.turn;

    makeJointChoice(battle, 'move 1', 'move 4'); // Moonblast chunks Clodsire; tox ticks
    expect(state.turn).toBe(turnBefore);
    expect(state.sides[1].mons[0].hp).toBe(hpBefore);
    expect(extractState(battle).turn).toBe(battle.turn);
  });

  it('reads weather, terrain, and trick room ids', () => {
    const battle = createBattle({
      p1: {team: [makeSet('Torkoal', ['Sunny Day', 'Yawn'], {ability: 'Drought'})]},
      p2: {
        team: [
          makeSet('Bronzong', ['Trick Room', 'Gyro Ball'], {
            ability: 'Levitate',
            evs: {hp: 252, atk: 252, def: 4, spa: 0, spd: 0, spe: 0},
          }),
        ],
      },
      seed: seedFromInts(5, 6, 7, 8),
    });
    let state = extractState(battle);
    expect(state.weather).toBe('sunnyday'); // Drought on entry
    expect(state.trickRoom).toBe(false);

    makeJointChoice(battle, 'move 2', 'move 1'); // Yawn | Trick Room
    state = extractState(battle);
    expect(state.trickRoom).toBe(true);
  });
});
