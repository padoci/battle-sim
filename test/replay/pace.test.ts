import {describe, expect, it} from 'vitest';
import {PACE, toBeats} from '../../src/replay/pace';
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
      expect(beat.durationMs).toBe(PACE.move);
      for (const event of beat.events.slice(1)) {
        expect(['damage', 'note']).toContain(event.kind);
      }
    }
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
