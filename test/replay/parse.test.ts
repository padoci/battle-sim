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

describe('battle-dialogue voice', () => {
  const spoken = parseProtocol(log, ['Your', 'The opposing'], {
    dialogue: true,
    trainer: 'Gym Leader Maylene',
  });
  const line = (event: {logText?: string}) => event.logText ?? '';

  it('sends Pokemon out the way the games do, not the way a log does', () => {
    const switches = spoken.filter(e => e.kind === 'switch');
    expect(switches.length).toBeGreaterThan(2);
    // Drags (Dragon Tail, Whirlwind) are not send-outs and read differently.
    const sent = switches.filter(e => e.kind === 'switch' && !e.drag);
    const mine = sent.filter(e => e.kind === 'switch' && e.ref.side === 0);
    const theirs = sent.filter(e => e.kind === 'switch' && e.ref.side === 1);
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    for (const event of mine) expect(line(event)).toMatch(/^Go! .+!$/);
    for (const event of theirs) expect(line(event)).toMatch(/^Gym Leader Maylene sent out .+!$/);
    // The phrasing this replaced.
    for (const event of switches) expect(line(event)).not.toContain('switched in');
    const dragged = switches.filter(e => e.kind === 'switch' && e.drag);
    for (const event of dragged) expect(line(event)).toMatch(/was dragged out!$/);
  });

  it('recalls the Pokemon it replaces, but not the lead and not a corpse', () => {
    const switches = spoken.filter(e => e.kind === 'switch');
    // The very first send-out on each side has nothing to recall.
    const leads = switches.slice(0, 2);
    for (const event of leads) {
      expect(event.kind === 'switch' && event.recallText).toBeUndefined();
    }
    const recalls = switches.filter(e => e.kind === 'switch' && e.recallText);
    expect(recalls.length).toBeGreaterThan(0);
    for (const event of recalls) {
      if (event.kind !== 'switch') continue;
      expect(event.recallText).toMatch(
        event.ref.side === 0 ? /^.+, come back!$/ : /^Gym Leader Maylene withdrew .+!$/
      );
    }

    // A knocked-out Pokemon is never recalled: every faint is followed by a
    // replacement switch on that side with no recall page.
    for (let i = 0; i < spoken.length; i++) {
      const event = spoken[i];
      if (event.kind !== 'faint') continue;
      const next = spoken.slice(i + 1).find(e => e.kind === 'switch' && e.ref.side === event.ref.side);
      if (next && next.kind === 'switch') expect(next.recallText).toBeUndefined();
    }
  });

  it('drops the possessive "Your" prefix that only reads in prose', () => {
    for (const event of spoken) {
      if (!('logText' in event) || !event.logText) continue;
      expect(event.logText).not.toMatch(/\bYour\b/);
    }
    const faints = spoken.filter(e => e.kind === 'faint');
    expect(faints.length).toBeGreaterThan(0);
    for (const event of faints) {
      expect(line(event)).toMatch(
        event.kind === 'faint' && event.ref.side === 0
          ? /^(?!The opposing).+ fainted!$/
          : /^The opposing .+ fainted!$/
      );
    }
  });

  it('describes stat changes in words instead of printing the raw delta', () => {
    const boosts = spoken.filter(e => e.kind === 'boost');
    expect(boosts.length).toBeGreaterThan(0);
    for (const event of boosts) {
      if (event.kind !== 'boost') continue;
      expect(line(event)).not.toMatch(/[+-]\d/);
      expect(line(event)).toMatch(/(rose|fell)( drastically| sharply| harshly| severely)?!$/);
      expect(line(event)).not.toMatch(/\b(atk|spa|spd|spe|def)\b/);
    }
  });

  it('leaves the neutral analysis voice alone', () => {
    const analysis = parseProtocol(log, ['You', 'The opponent']);
    const switches = analysis.filter(e => e.kind === 'switch');
    expect(switches.length).toBeGreaterThan(2);
    for (const event of switches) {
      if (event.kind !== 'switch') continue;
      expect(line(event)).toContain(event.drag ? 'was dragged in' : 'switched in');
      expect(event.recallText).toBeUndefined();
    }
  });
});
