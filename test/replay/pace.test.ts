import {describe, expect, it} from 'vitest';
import {BIG_HIT_BONUS_MS, PACE, toBeats} from '../../src/replay/pace';
import {parseProtocol} from '../../src/replay/parse';
import fixture from '../fixtures/protocol.fixture.json';

const events = parseProtocol((fixture as {log: string[]}).log);
const beats = toBeats(events);

describe('toBeats', () => {
  it('covers every event exactly once', () => {
    expect(beats.flatMap(b => b.events)).toHaveLength(events.length);
  });

  it('groups a move with its direct damage and annotations into one beat', () => {
    const moveBeats = beats.filter(b => b.events[0].kind === 'move');
    expect(moveBeats.length).toBeGreaterThan(10);
    const withDamage = moveBeats.filter(b => b.events.some(e => e.kind === 'damage'));
    expect(withDamage.length).toBeGreaterThan(5);
    for (const beat of withDamage) {
      const move = beat.events[0];
      const bigHit = move.kind === 'move' && (move.tags.crit || move.tags.supereffective);
      expect(beat.durationMs).toBe(PACE.move + (bigHit ? BIG_HIT_BONUS_MS : 0));
      for (const event of beat.events.slice(1)) {
        expect(['damage', 'note']).toContain(event.kind);
      }
    }
  });

  it('holds crit/super-effective move beats a beat longer (and only those)', () => {
    const move = (tags: Record<string, boolean>) =>
      ({kind: 'move', ref: {side: 0, name: 'X'}, move: 'Surf', tags, logText: ''}) as const;
    const [plain] = toBeats([move({})]);
    const [crit] = toBeats([move({crit: true})]);
    const [supereffective] = toBeats([move({supereffective: true})]);
    const [resisted] = toBeats([move({resisted: true})]);
    expect(plain.durationMs).toBe(PACE.move);
    expect(crit.durationMs).toBe(PACE.move + BIG_HIT_BONUS_MS);
    expect(supereffective.durationMs).toBe(PACE.move + BIG_HIT_BONUS_MS);
    expect(resisted.durationMs).toBe(PACE.move); // only big hits get the hold
  });

  it('keeps residual damage as its own beat', () => {
    const residuals = beats.filter(
      b => b.events.length === 1 && b.events[0].kind === 'damage' && b.events[0].from
    );
    expect(residuals.length).toBeGreaterThan(0);
    for (const beat of residuals) expect(beat.durationMs).toBe(PACE.residual);
  });

  it('every beat gets a duration from the PACE table', () => {
    const allowed = new Set<number>(Object.values(PACE));
    for (const beat of beats) expect(allowed.has(beat.durationMs)).toBe(true);
  });
});
