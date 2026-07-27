import {describe, expect, it} from 'vitest';
import {parseProtocol} from '../../src/replay/parse';
import {toBeats} from '../../src/replay/pace';
import {LANDING_REEL_LOG, LANDING_REEL_META} from '../../src/data/landingReel';
import {POSTER_FRAME} from '../../src/app/components/useLandingReel';

/**
 * The landing reel is the first thing a visitor sees, and it runs unattended
 * in a loop, so the things worth guarding are the ones nobody would notice
 * breaking: an HP bar that goes negative or past 100%, a frame that renders
 * "undefined" as the message, or a battle that turns out to be a loss.
 *
 * This rebuilds the frame sequence the same way the hook does. The hook itself
 * is timers and a dynamic import — covered by the e2e walkthrough, not here.
 */

const beats = toBeats(parseProtocol(LANDING_REEL_LOG, ['Your', 'The opposing']));

interface Mon {
  species: string;
  hp: number;
  maxhp: number;
}
interface Frame {
  theirs: Mon;
  mine: Mon;
  message: string;
}

/** Mirrors applyEvent in useLandingReel.ts. */
function buildFrames(): Frame[] {
  const frames: Frame[] = [];
  let frame: Frame = JSON.parse(JSON.stringify(POSTER_FRAME));
  for (const beat of beats) {
    for (const event of beat.events) {
      const key = 'ref' in event ? (event.ref.side === 0 ? 'mine' : 'theirs') : undefined;
      if (event.kind === 'switch' && key) {
        frame = {...frame, [key]: {species: event.species, hp: event.hp, maxhp: event.maxhp || 100}};
      } else if ((event.kind === 'damage' || event.kind === 'heal') && key) {
        const current = frame[key];
        frame = {
          ...frame,
          [key]: {...current, hp: Math.max(0, event.hp), maxhp: event.maxhp || current.maxhp},
        };
      } else if (event.kind === 'faint' && key) {
        frame = {...frame, [key]: {...frame[key], hp: 0}};
      }
      if ('logText' in event && event.logText) frame = {...frame, message: event.logText};
    }
    frames.push(frame);
  }
  return frames;
}

const frames = buildFrames();

describe('the vendored landing reel', () => {
  it('is a real, complete battle', () => {
    expect(LANDING_REEL_LOG.length).toBeGreaterThan(100);
    expect(beats.length).toBeGreaterThan(50);
    expect(LANDING_REEL_META.turns).toBeGreaterThan(10);
  });

  it('is a battle YOUR side wins — this is the first thing a visitor sees', () => {
    const events = parseProtocol(LANDING_REEL_LOG, ['Your', 'The opposing']);
    const win = events.filter(e => e.kind === 'win').at(-1);
    expect(win, 'the reel must reach a decided ending, not a stall').toBeDefined();
    expect(win?.kind === 'win' && win.side).toBe(0);
  });

  it('ends on the winning line, so the loop restarts from a resolved battle', () => {
    expect(frames.at(-1)?.message).toMatch(/wins!/);
  });

  it('actually shows the game being played — switches, KOs and Tera', () => {
    const events = parseProtocol(LANDING_REEL_LOG, ['Your', 'The opposing']);
    expect(events.filter(e => e.kind === 'faint').length).toBeGreaterThanOrEqual(4);
    expect(events.filter(e => e.kind === 'switch').length).toBeGreaterThanOrEqual(4);
    expect(events.some(e => e.kind === 'tera')).toBe(true);
  });

  it('matches the metadata vendored alongside it', () => {
    expect(beats.length).toBe(LANDING_REEL_META.beats);
    expect(beats.reduce((s, b) => s + b.durationMs, 0)).toBe(LANDING_REEL_META.durationMs);
  });
});

describe('every frame the landing page can render', () => {
  it('keeps both HP bars within 0-100%', () => {
    for (const [i, frame] of frames.entries()) {
      for (const side of ['theirs', 'mine'] as const) {
        const mon = frame[side];
        expect(mon.maxhp, `frame ${i} ${side} maxhp`).toBeGreaterThan(0);
        expect(mon.hp, `frame ${i} ${side} hp`).toBeGreaterThanOrEqual(0);
        const pct = (mon.hp / mon.maxhp) * 100;
        expect(pct, `frame ${i} ${side} = ${pct}%`).toBeLessThanOrEqual(100);
      }
    }
  });

  it('never renders an empty, undefined or NaN message', () => {
    for (const [i, frame] of frames.entries()) {
      expect(frame.message, `frame ${i}`).toBeTruthy();
      expect(frame.message, `frame ${i}`).not.toMatch(/\bundefined\b|\bNaN\b/);
    }
  });

  it('never renders a raw protocol string', () => {
    for (const frame of frames) expect(frame.message).not.toContain('|');
  });

  it('always has a named species on both sides', () => {
    for (const [i, frame] of frames.entries()) {
      expect(frame.theirs.species, `frame ${i}`).toBeTruthy();
      expect(frame.mine.species, `frame ${i}`).toBeTruthy();
    }
  });

  it('holds every frame for a positive, sane duration', () => {
    for (const beat of beats) {
      expect(beat.durationMs).toBeGreaterThan(0);
      expect(beat.durationMs).toBeLessThan(10_000);
    }
  });
});

describe('the poster frame', () => {
  it('is self-consistent, since it renders before the reel loads and under reduced motion', () => {
    for (const side of ['theirs', 'mine'] as const) {
      const mon = POSTER_FRAME[side];
      expect(mon.species).toBeTruthy();
      expect(mon.maxhp).toBeGreaterThan(0);
      expect(mon.hp).toBeGreaterThanOrEqual(0);
      expect(mon.hp).toBeLessThanOrEqual(mon.maxhp);
    }
    expect(POSTER_FRAME.message).toBeTruthy();
  });
});
