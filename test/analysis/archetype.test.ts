import {describe, expect, it} from 'vitest';
import {gen9} from '../../src/data/gen';
import {teamMemberToSet} from '../../src/data/team';
import type {Team} from '../../src/data/types';
import {classifyTeam, extractFeatures, teamDisplayName} from '../../src/analysis/archetype';
import {makeSet} from '../engine/helpers';
import fullTeams from '../fixtures/gen9ou.teams.full.json';

const gen = gen9();

const offensive = (species: string) =>
  makeSet(species, ['Swords Dance', 'Sucker Punch'], {
    ability: '',
    nature: 'Jolly',
    evs: {hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252},
  });

const defensive = (species: string) =>
  makeSet(species, ['Recover', 'Toxic'], {
    ability: '',
    nature: 'Bold',
    evs: {hp: 252, atk: 0, def: 252, spa: 0, spd: 4, spe: 0},
  });

describe('classifyTeam', () => {
  it('weather setter is the strongest signal (Rain)', () => {
    const team = [
      makeSet('Pelipper', ['Hurricane', 'U-turn'], {ability: 'Drizzle'}),
      offensive('Barraskewda'),
      defensive('Toxapex'),
    ];
    const result = classifyTeam(gen, team);
    expect(result.primary).toBe('rain');
    expect(result.features.weatherSetter).toEqual({species: 'Pelipper', weather: 'rain'});
  });

  it('rain + heavy offense earns the hybrid tag (Rain HO)', () => {
    const team = [
      makeSet('Pelipper', ['Hurricane'], {ability: 'Drizzle'}),
      offensive('Barraskewda'),
      offensive('Floatzel'),
      offensive('Kingambit'),
      offensive('Dragapult'),
      offensive('Iron Valiant'),
    ];
    const result = classifyTeam(gen, team);
    expect(result.primary).toBe('rain');
    expect(result.secondary).toBe('hyper-offense');
    expect(result.label).toBe('Rain HO');
  });

  it('5+ offensive mons with no weather is Hyper Offense', () => {
    const team = [
      offensive('Kingambit'),
      offensive('Dragapult'),
      offensive('Iron Valiant'),
      offensive('Roaring Moon'),
      offensive('Barraskewda'),
      defensive('Clefable'),
    ];
    expect(classifyTeam(gen, team).primary).toBe('hyper-offense');
  });

  it('5+ defensive mons is Stall; 3+ with one attacker is Semi Stall; mixed is Balance', () => {
    const stall = [
      defensive('Toxapex'),
      defensive('Blissey'),
      defensive('Dondozo'),
      defensive('Clodsire'),
      defensive('Corviknight'),
    ];
    expect(classifyTeam(gen, stall).primary).toBe('stall');

    const semiStall = [
      defensive('Toxapex'),
      defensive('Blissey'),
      defensive('Dondozo'),
      defensive('Clodsire'),
      offensive('Kingambit'),
    ];
    expect(classifyTeam(gen, semiStall).primary).toBe('semi-stall');

    const balance = [
      offensive('Kingambit'),
      offensive('Dragapult'),
      defensive('Toxapex'),
      defensive('Blissey'),
      makeSet('Great Tusk', ['Rapid Spin', 'Headlong Rush'], {nature: 'Serious'}),
    ];
    expect(classifyTeam(gen, balance).primary).toBe('balance');
  });

  it('detects offensive mons via Choice items, Booster Energy, and setup moves', () => {
    const features = extractFeatures(gen, [
      makeSet('Enamorus', ['Moonblast'], {item: 'Choice Scarf', nature: 'Bold'}),
      makeSet('Roaring Moon', ['Crunch'], {item: 'Booster Energy', nature: 'Bold'}),
      makeSet('Kingambit', ['Swords Dance', 'Iron Head'], {nature: 'Careful'}),
      makeSet('Blissey', ['Seismic Toss'], {nature: 'Calm'}),
    ]);
    expect(features.offensiveCount).toBe(3);
    expect(features.offensiveMons).not.toContain('Blissey');
  });

  it('detects defensive mons via recovery, hazards, and phazing', () => {
    const features = extractFeatures(gen, [
      makeSet('Garganacl', ['Recover', 'Salt Cure'], {nature: 'Careful'}),
      makeSet('Ting-Lu', ['Stealth Rock', 'Earthquake'], {nature: 'Careful'}),
      makeSet('Zamazenta', ['Roar', 'Body Press'], {nature: 'Jolly'}),
      makeSet('Darkrai', ['Dark Pulse'], {nature: 'Modest'}),
    ]);
    expect(features.defensiveCount).toBe(3);
    expect(features.defensiveMons).not.toContain('Darkrai');
  });

  it('3+ offensive backed by 2+ defensive mons is Bulky Offense', () => {
    const team = [
      offensive('Kingambit'),
      offensive('Dragapult'),
      offensive('Roaring Moon'),
      defensive('Toxapex'),
      defensive('Blissey'),
    ];
    expect(classifyTeam(gen, team).primary).toBe('bulky-offense');
  });

  it('a Sticky Web setter earns the Webs tag', () => {
    const team = [
      makeSet('Grafaiai', ['Sticky Web'], {nature: 'Jolly'}),
      offensive('Dragapult'),
      offensive('Kingambit'),
    ];
    const result = classifyTeam(gen, team);
    expect(result.features.tag).toBe('webs');
    expect(result.label).toContain('Webs');
  });

  it('2+ mons stacking 2+ distinct hazards earns the Hazard Stack tag', () => {
    const team = [
      makeSet('Ting-Lu', ['Stealth Rock', 'Earthquake'], {nature: 'Careful'}),
      makeSet('Garganacl', ['Spikes', 'Recover'], {nature: 'Careful'}),
      offensive('Kingambit'),
    ];
    const result = classifyTeam(gen, team);
    expect(result.features.tag).toBe('hazard-stack');
    expect(result.label).toContain('Hazard Stack');
  });

  it('4+ mons sharing a type earns the Type Spam tag', () => {
    const team = [
      makeSet('Toxapex', ['Recover'], {nature: 'Bold'}),
      makeSet('Dondozo', ['Wave Crash'], {nature: 'Adamant'}),
      makeSet('Barraskewda', ['Liquidation'], {nature: 'Jolly'}),
      makeSet('Floatzel', ['Liquidation'], {nature: 'Jolly'}),
    ];
    const result = classifyTeam(gen, team);
    expect(result.features.tag).toBe('type-spam');
    expect(result.features.spamType).toBe('Water');
    expect(result.label).toContain('Water Spam');
  });

  it('picks setup sweepers as key mons over generic offensive mons', () => {
    const features = extractFeatures(gen, [
      makeSet('Pelipper', ['Hurricane'], {ability: 'Drizzle'}),
      offensive('Roaring Moon'), // has Swords Dance
      makeSet('Barraskewda', ['Liquidation'], {item: 'Choice Band', nature: 'Jolly'}),
    ]);
    expect(features.keyMons[0]).toBe('Roaring Moon');
  });

  it('deprioritizes meta-staple species when picking key mons', () => {
    const features = extractFeatures(gen, [
      offensive('Kingambit'), // has Swords Dance, but is a staple
      makeSet('Okidogi', ['Close Combat'], {item: 'Choice Band', nature: 'Adamant'}),
    ]);
    expect(features.keyMons).toContain('Okidogi');
  });

  it('classifies all 10 real gen9ou teams without crashing (labels are tunable)', () => {
    const teams = fullTeams as Team[];
    expect(teams).toHaveLength(10);
    const labels = teams.map(team => {
      const result = classifyTeam(gen, team.data.map(teamMemberToSet));
      expect(result.label.length).toBeGreaterThan(0);
      expect(result.features.offensiveCount + result.features.defensiveCount).toBeGreaterThan(0);
      return result.label;
    });
    // At least two distinct archetypes across the real pool (sanity, not gospel).
    expect(new Set(labels).size).toBeGreaterThan(1);
  });
});

describe('teamDisplayName', () => {
  it('derives a deterministic, friendly name — never the index placeholder', () => {
    const gen = gen9();
    const teams = fullTeams as Team[];
    for (const team of teams) {
      const sets = team.data.map(teamMemberToSet);
      const name = teamDisplayName(gen, sets);
      expect(name.length).toBeGreaterThan(0);
      expect(name).not.toMatch(/^Team #\d+$/);
      expect(sets.some(set => name.includes(set.species))).toBe(true);
      expect(teamDisplayName(gen, sets)).toBe(name); // deterministic
    }
  });
});
