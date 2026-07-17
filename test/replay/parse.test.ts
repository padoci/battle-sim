import {describe, expect, it} from 'vitest';
import {parseProtocol, parseRef} from '../../src/replay/parse';
import fixture from '../fixtures/protocol.fixture.json';

/**
 * protocol.fixture.json is vendored; regenerate with:
 *   runBattle(gen9(), {teams: [teams.fixture[0], teams.fixture[1]].map(t => t.data.map(teamMemberToSet)),
 *     battleSeed: seedFromInts(1,2,3,4), searchSeed: 42,
 *     policies: [{kind:'search',config:FAST},{kind:'search',config:FAST}], collectLog: true})
 */
const log = (fixture as {log: string[]}).log;
const events = parseProtocol(log);

describe('parseRef', () => {
  it('parses side and nickname', () => {
    expect(parseRef('p1a: Darkrai')).toEqual({side: 0, name: 'Darkrai'});
    expect(parseRef('p2a: Slowking')).toEqual({side: 1, name: 'Slowking'});
    expect(parseRef('nonsense')).toBeUndefined();
  });
});

describe('parseProtocol on a real battle log', () => {
  it('takes the SECRET split copy: switch events carry exact maxhp, not 100', () => {
    const switches = events.filter(e => e.kind === 'switch');
    expect(switches.length).toBeGreaterThan(2);
    // Darkrai's real max HP is 281 in the fixture (secret line), not 100.
    const darkrai = switches.find(e => e.kind === 'switch' && e.species === 'Darkrai');
    expect(darkrai && darkrai.kind === 'switch' && darkrai.maxhp).toBe(281);
    // No switch should have the public 100/100 shape for a non-100-hp mon.
    const tingLu = switches.find(e => e.kind === 'switch' && e.species === 'Ting-Lu');
    expect(tingLu && tingLu.kind === 'switch' && tingLu.maxhp).toBe(514);
  });

  it('attaches sourceMove to direct damage and [from] to indirect', () => {
    const direct = events.filter(e => e.kind === 'damage' && e.sourceMove);
    expect(direct.length).toBeGreaterThan(5);
    for (const event of direct) {
      if (event.kind !== 'damage' || !event.sourceMove) continue;
      expect(event.sourceMove.ref.side).not.toBe(event.ref.side);
      expect(event.from).toBeUndefined();
    }
    const hazard = events.find(e => e.kind === 'damage' && e.from?.includes('Stealth Rock'));
    expect(hazard).toBeDefined();
  });

  it('captures turns, tera, faints, side conditions, and the winner', () => {
    const turns = events.filter(e => e.kind === 'turn');
    expect(turns.length).toBe((fixture as {turns: number}).turns);
    expect(events.some(e => e.kind === 'tera')).toBe(true);
    expect(events.filter(e => e.kind === 'faint').length).toBeGreaterThan(0);
    expect(events.some(e => e.kind === 'side' && e.effect === 'Stealth Rock' && e.start)).toBe(true);
    const win = events.at(-1);
    expect(win?.kind).toBe('win');
    expect(win?.kind === 'win' && win.side).toBe((fixture as {winner: number}).winner);
  });

  it('accounts for every line but never leaks raw protocol into the log', () => {
    const parsed = parseProtocol(['|turn|1', '|-madeupthing|p1a: X|stuff']);
    expect(parsed).toHaveLength(2);
    // Still a note event (accounted), but no raw `·` protocol string shown.
    expect(parsed[1]).toMatchObject({kind: 'note', text: 'unknown:-madeupthing', logText: ''});
    expect(parsed[1].kind === 'note' && parsed[1].logText).not.toMatch(/·|madeupthing/);
  });

  it('drops [silent] lines (e.g. the upstream fallenundefined) from the log', () => {
    const parsed = parseProtocol(['|-end|p1a: Kingambit|fallenundefined|[silent]']);
    expect(parsed[0]).toMatchObject({kind: 'note', logText: ''});
    expect(parsed.every(e => !('logText' in e) || !/fallenundefined|·/.test(e.logText))).toBe(true);
  });

  it('translates common notes to clean text and uses possessive-position labels', () => {
    const parsed = parseProtocol(
      [
        '|switch|p1a: Great Tusk|Great Tusk, M|100/100',
        '|-ability|p2a: Landorus|Intimidate|boost',
        '|-enditem|p1a: Great Tusk|Heavy-Duty Boots|[from] move: Knock Off',
      ],
      ['Your', 'The opposing']
    );
    const text = parsed.map(e => ('logText' in e ? e.logText : '')).filter(Boolean);
    expect(text).toContain('Your Great Tusk switched in!'); // not "You's ..."
    expect(text).toContain('The opposing Landorus\'s Intimidate!');
    expect(text).toContain('Your Great Tusk lost its Heavy-Duty Boots!');
    expect(text.every(t => !t.includes("'s "))).toBe(false); // possessive still used where correct
    expect(text.some(t => /You's|Them's/.test(t))).toBe(false); // but never the broken form
  });

  it('move annotations tag the pending move', () => {
    // This fixture battle has resisted + immune annotations (the AIs avoid
    // super-effective trades against each other).
    const resisted = events.filter(e => e.kind === 'move' && e.tags.resisted);
    const immune = events.filter(e => e.kind === 'move' && e.tags.immune);
    expect(resisted.length).toBeGreaterThan(0);
    expect(immune.length).toBeGreaterThan(0);
  });
});
