import {describe, expect, it} from 'vitest';
import {
  BIG_HIT_BONUS_MS,
  DRAIN_FULL_BAR_MS,
  DRAIN_MAX_MS,
  DRAIN_MIN_MS,
  drainMs,
  PACE,
  PAGE_MS,
  pageCount,
  toBeats,
  TYPE_SHARE_OF_PAGE,
  typePlan,
  typePlanFits,
} from '../../src/replay/pace';
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
      // The message box speaks one line at a time, so a beat that has to say
      // "X used Y!" AND "It's super effective!" is paid for both pages.
      const extraPages = Math.max(0, pageCount(beat.events) - 1);
      expect(beat.durationMs).toBe(
        PACE.move + (bigHit ? BIG_HIT_BONUS_MS : 0) + extraPages * PAGE_MS
      );
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
    // PACE.move + BIG_HIT_BONUS_MS is a legitimate duration, so it belongs in
    // the allowed set. Listing that one combination rather than a cross-product
    // of every PACE value with the bonus keeps the assertion tight.
    const allowed = new Set<number>([...Object.values(PACE), PACE.move + BIG_HIT_BONUS_MS]);
    // The fixture happens to contain no crits and no super-effective hits, so
    // it alone would never produce the bonus duration and this test would pass
    // without ever exercising it. Synthetic beats cover the gap.
    const move = (tags: Record<string, boolean>) =>
      ({kind: 'move', ref: {side: 0, name: 'X'}, move: 'Surf', tags, logText: ''}) as const;
    const synthetic = toBeats([move({crit: true}), move({supereffective: true}), move({})]);
    expect(synthetic.some(b => b.durationMs === PACE.move + BIG_HIT_BONUS_MS)).toBe(true);

    // Subtract the per-page allowance first: it is a legitimate addition on
    // top of a PACE value, and folding it in keeps this assertion pinned to
    // the table rather than to an ever-growing set of sums.
    for (const beat of [...beats, ...synthetic]) {
      const base = beat.durationMs - Math.max(0, pageCount(beat.events) - 1) * PAGE_MS;
      expect(allowed.has(base)).toBe(true);
    }
  });

  it('pays for every textbox page after the first', () => {
    const move = (tags: Record<string, boolean>) =>
      ({kind: 'move', ref: {side: 0, name: 'X'}, move: 'Surf', tags, logText: 'X used Surf!'}) as const;
    const note = (text: string) => ({kind: 'note', text, logText: `It's ${text}!`}) as const;

    const [oneLine] = toBeats([move({})]);
    expect(oneLine.durationMs).toBe(PACE.move);

    // A move plus its effectiveness note is two pages, so one extra page's
    // worth of time on top of the big-hit hold.
    const [twoLines] = toBeats([move({supereffective: true}), note('supereffective')]);
    expect(pageCount(twoLines.events)).toBe(2);
    expect(twoLines.durationMs).toBe(PACE.move + BIG_HIT_BONUS_MS + PAGE_MS);
    // Stated without PAGE_MS on both sides: comparing two expressions that
    // both contain the constant passes just as happily when it is zero, which
    // is precisely the regression this test exists to catch.
    expect(twoLines.durationMs).toBeGreaterThan(oneLine.durationMs + BIG_HIT_BONUS_MS);
    expect(PAGE_MS).toBeGreaterThanOrEqual(300);
  });

  it('gives a switch room for both its recall and its send-out page', () => {
    const base = {
      kind: 'switch',
      ref: {side: 0, name: 'Fezandipiti'},
      species: 'Fezandipiti',
      hp: 100,
      maxhp: 100,
      drag: false,
      logText: 'Go! Fezandipiti!',
    } as const;

    const [lead] = toBeats([base]);
    expect(lead.durationMs).toBe(PACE.switch);

    const [swap] = toBeats([{...base, recallText: 'Dragapult, come back!'}]);
    expect(pageCount(swap.events)).toBe(2);
    expect(swap.durationMs).toBe(PACE.switch + PAGE_MS);
    expect(swap.durationMs).toBeGreaterThan(lead.durationMs);
  });
});

describe('drainMs', () => {
  it('drains at a constant rate, so a big hit takes longer than a chip', () => {
    expect(drainMs(0.5)).toBeGreaterThan(drainMs(0.2));
    expect(drainMs(0.2)).toBeGreaterThan(drainMs(0.05));
    // Half a bar is half the full-bar time.
    expect(drainMs(0.5)).toBe(Math.round(DRAIN_FULL_BAR_MS / 2));
  });

  it('clamps both ends so a twitch is visible and a nuke fits its beat', () => {
    expect(drainMs(0.001)).toBe(DRAIN_MIN_MS);
    expect(drainMs(1)).toBe(DRAIN_MAX_MS);
  });

  it('scales with playback speed so the drain never outlives its beat', () => {
    expect(drainMs(1, 5)).toBe(Math.round(DRAIN_MAX_MS / 5));
    expect(drainMs(0.5, 2)).toBe(Math.round(DRAIN_FULL_BAR_MS / 2 / 2));
  });

  it('treats a heal the same as a hit', () => {
    expect(drainMs(-0.4)).toBe(drainMs(0.4));
  });
});

describe('typePlan', () => {
  // Every page of every beat kind, across the whole speed slider. The reveal
  // has to finish inside its own share of the beat: the next beat replaces the
  // box, so an overrunning page is one the reader never sees at all.
  it('always finishes a page inside the time that page has', () => {
    const speeds = [0.1, 0.5, 1, 2, 3, 5];
    const beatKinds = Object.values(PACE);
    const lengths = [8, 21, 25, 30, 36, 37, 46, 60];
    for (const speed of speeds) {
      for (const base of beatKinds) {
        for (const pages of [1, 2, 3]) {
          // What the component sees: the beat is already divided by speed, and
          // a multi-page beat has bought itself PAGE_MS per extra page.
          const beatMs = (base + (pages - 1) * PAGE_MS) / speed;
          const pageMs = beatMs / pages;
          for (const chars of lengths) {
            expect(
              typePlanFits(pageMs, chars, speed),
              `page overran: ${chars} chars in ${pageMs.toFixed(0)}ms at ${speed}x`
            ).toBe(true);
          }
        }
      }
    }
  });

  it('prints instead of typing when the page is too short to type in', () => {
    // A turn prompt at 5x: 400/5 = 80ms for ~21 characters.
    expect(typePlan(80, 21, 5).instant).toBe(true);
    // The same prompt at 1x has room to type.
    expect(typePlan(400, 21, 1).instant).toBe(false);
  });

  it('reveals several glyphs per tick rather than ticking faster than a frame', () => {
    const plan = typePlan(725, 36, 1);
    expect(plan.instant).toBe(false);
    expect(plan.tick).toBeGreaterThanOrEqual(16);
    expect(plan.step).toBeGreaterThanOrEqual(1);
    // The regression: rounding the step DOWN to 1 made the reveal slower than
    // its own budget, so the second page of a switch beat was cut off.
    expect(plan.totalMs).toBeLessThanOrEqual(725 * TYPE_SHARE_OF_PAGE + 1);
  });
});
