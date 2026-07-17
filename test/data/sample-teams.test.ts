import {describe, expect, it} from 'vitest';
import {MemoryStore} from '../../src/data/cache';
import {fetchSampleTeams, mergeTeams} from '../../src/data/sampleTeams';
import {setToTeamMember, teamMemberToSet} from '../../src/data/team';
import type {Team} from '../../src/data/types';

const LEGAL_TEAM = `Great Tusk @ Heavy-Duty Boots
Ability: Protosynthesis
Tera Type: Water
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Headlong Rush
- Ice Spinner
- Rapid Spin
- Knock Off

Kingambit @ Leftovers
Ability: Supreme Overlord
Tera Type: Ghost
EVs: 112 HP / 252 Atk / 144 Spe
Adamant Nature
- Swords Dance
- Kowtow Cleave
- Sucker Punch
- Iron Head

Dragapult @ Choice Specs
Ability: Infiltrator
Tera Type: Ghost
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Shadow Ball
- Draco Meteor
- Flamethrower
- U-turn

Gholdengo @ Air Balloon
Ability: Good as Gold
Tera Type: Fighting
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Make It Rain
- Shadow Ball
- Nasty Plot
- Recover

Gliscor @ Toxic Orb
Ability: Poison Heal
Tera Type: Water
EVs: 244 HP / 248 SpD / 16 Spe
Careful Nature
- Earthquake
- Knock Off
- Protect
- Spikes

Slowking-Galar @ Heavy-Duty Boots
Ability: Regenerator
Tera Type: Water
EVs: 248 HP / 8 Def / 252 SpD
Sassy Nature
IVs: 0 Atk / 0 Spe
- Chilly Reception
- Future Sight
- Sludge Bomb
- Thunder Wave
`;

// Same six slots, but Great Tusk swapped for OU-banned Miraidon.
const ILLEGAL_TEAM = LEGAL_TEAM.replace(
  `Great Tusk @ Heavy-Duty Boots
Ability: Protosynthesis
Tera Type: Water
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Headlong Rush
- Ice Spinner
- Rapid Spin
- Knock Off`,
  `Miraidon @ Choice Specs
Ability: Hadron Engine
Tera Type: Electric
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Electro Drift
- Draco Meteor
- Volt Switch
- Overheat`
);

/** A fetch stub: index at indexUrl, pokepaste `/json` bodies keyed by url. */
function stubFetch(index: unknown, pastes: Record<string, unknown>): {
  fetchFn: typeof fetch;
  calls: () => number;
} {
  let n = 0;
  const fetchFn = (async (input: RequestInfo | URL) => {
    n++;
    const url = String(input);
    if (url in pastes) {
      return {ok: true, json: async () => pastes[url]} as Response;
    }
    if (url.endsWith('/gen9ou') || url.includes('samples')) {
      return {ok: true, json: async () => index} as Response;
    }
    return {ok: false, status: 404, json: async () => ({})} as Response;
  }) as unknown as typeof fetch;
  return {fetchFn, calls: () => n};
}

describe('setToTeamMember', () => {
  it('round-trips through teamMemberToSet preserving the battling identity', () => {
    const wire = {
      species: 'Kingambit',
      item: 'Leftovers',
      ability: 'Supreme Overlord',
      teraType: 'Ghost',
      nature: 'Adamant',
      moves: ['Swords Dance', 'Kowtow Cleave', 'Sucker Punch', 'Iron Head'],
      evs: {hp: 112, atk: 252, def: 0, spa: 0, spd: 0, spe: 144},
      ivs: {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31},
      level: 100,
    };
    const back = setToTeamMember(teamMemberToSet(wire));
    expect(back.species).toBe('Kingambit');
    expect(back.item).toBe('Leftovers');
    expect(back.ability).toBe('Supreme Overlord');
    expect(back.teraType).toBe('Ghost');
    expect(back.moves).toEqual(wire.moves);
    expect(back.evs).toEqual(wire.evs);
  });
});

describe('mergeTeams', () => {
  const team = (species: string[]): Team => ({
    name: species[0],
    data: species.map(s => ({species: s, ability: '', moves: []})),
  });

  it('drops teams whose species set already appeared (order-independent)', () => {
    const a = team(['Great Tusk', 'Kingambit', 'Dragapult']);
    const b = team(['Kingambit', 'Great Tusk', 'Dragapult']); // same set, shuffled
    const c = team(['Gliscor', 'Gholdengo', 'Slowking-Galar']);
    const merged = mergeTeams([a], [b, c]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(a);
    expect(merged[1]).toBe(c);
  });
});

describe('fetchSampleTeams', () => {
  it('resolves pokepaste refs, imports, validates, and shapes into Team[]', async () => {
    const index = [
      {name: 'Sample A', author: 'coach', url: 'https://pokepast.es/aaa'},
      {name: 'Banned B', author: 'nobody', url: 'https://pokepast.es/bbb'},
    ];
    const {fetchFn} = stubFetch(index, {
      'https://pokepast.es/aaa/json': {paste: LEGAL_TEAM, title: 'Sample A', author: 'coach'},
      'https://pokepast.es/bbb/json': {paste: ILLEGAL_TEAM, title: 'Banned B', author: 'nobody'},
    });
    const teams = await fetchSampleTeams({store: new MemoryStore(), fetchFn, indexUrl: 'https://crob.at/api/samples/gen9ou'});
    // The banned team is dropped; the legal one survives with metadata + 6 mons.
    expect(teams).toHaveLength(1);
    expect(teams[0].name).toBe('Sample A');
    expect(teams[0].author).toBe('coach');
    expect(teams[0].data).toHaveLength(6);
    expect(teams[0].data.map(m => m.species)).toContain('Great Tusk');
  });

  it('accepts inline export text in the index (no round-trip)', async () => {
    const index = {teams: [{name: 'Inline', paste: LEGAL_TEAM}]};
    const {fetchFn, calls} = stubFetch(index, {});
    const teams = await fetchSampleTeams({store: new MemoryStore(), fetchFn, indexUrl: 'https://crob.at/api/samples/gen9ou'});
    expect(teams).toHaveLength(1);
    expect(calls()).toBe(1); // only the index fetch — inline needs no pokepaste call
  });

  it('serves a cached result without re-fetching within the TTL', async () => {
    const index = [{name: 'Sample A', url: 'https://pokepast.es/aaa'}];
    const {fetchFn, calls} = stubFetch(index, {'https://pokepast.es/aaa/json': {paste: LEGAL_TEAM}});
    const store = new MemoryStore();
    const opts = {store, fetchFn, indexUrl: 'https://crob.at/api/samples/gen9ou', now: () => 1000};
    const first = await fetchSampleTeams(opts);
    const after = calls();
    const second = await fetchSampleTeams(opts);
    expect(second).toEqual(first);
    expect(calls()).toBe(after); // no additional network calls
  });

  it('returns [] when the index is unreachable (never throws)', async () => {
    const fetchFn = (async () => ({ok: false, status: 500, json: async () => ({})}) as Response) as unknown as typeof fetch;
    const teams = await fetchSampleTeams({store: new MemoryStore(), fetchFn});
    expect(teams).toEqual([]);
  });
});
