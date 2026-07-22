// @vitest-environment jsdom
import {createElement, useEffect} from 'react';
import {act, cleanup, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {MAX_SPEED, loadSpeed, usePlayback, type Playback, type PlaybackOpts} from '../../src/app/sixoh/usePlayback';
import type {Beat} from '../../src/replay/pace';
import {makeSet} from '../engine/helpers';

/**
 * Two concerns, matching the real parent/child boundary (`Inner` is
 * BattleStage, `Parent` is SixOhGauntlet):
 *
 * 1. The "battle resets mid-playback" regression: `onDone` is a fresh
 *    closure every parent render, and usePlayback must stay referentially
 *    stable across that (reads it through a ref).
 * 2. Streaming: the beats array GROWS (new identity per streamed decision).
 *    Playback must never restart on beats identity, must park when it
 *    catches up to an unfinished stream, resume as more beats land, and
 *    finish only when the stream is done AND every beat has played.
 */

const TEAMS: [ReturnType<typeof makeSet>[], ReturnType<typeof makeSet>[]] = [
  [makeSet('Pikachu', ['Thunderbolt'])],
  [makeSet('Bulbasaur', ['Tackle'])],
];
const beatsOf = (n: number, offset = 0): Beat[] =>
  Array.from({length: n}, (_, i) => ({
    events: [{kind: 'turn' as const, turn: offset + i + 1}],
    durationMs: 100,
  }));
const BEATS: Beat[] = beatsOf(8);

let latest: Playback | undefined;
let renderCount = 0;
let doneCallCount = 0;

function Inner({onDone, beats, opts}: {onDone: () => void; beats: Beat[]; opts: PlaybackOpts}) {
  const playback = usePlayback(TEAMS, beats, onDone, opts);
  useEffect(() => {
    latest = playback;
  });
  return null;
}

/** Mirrors SixOhGauntlet: a fresh onDone closure every time PARENT itself
 *  renders — not on Inner's own beat-driven re-renders. */
function Parent({beats = BEATS, opts = {streamDone: true, battleKey: 0}}: {beats?: Beat[]; opts?: PlaybackOpts}) {
  renderCount++;
  const onDone = () => {
    doneCallCount++;
  };
  return createElement(Inner, {onDone, beats, opts});
}

describe('usePlayback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    latest = undefined;
    renderCount = 0;
    doneCallCount = 0;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does not reset progress when the parent re-renders for an unrelated reason', () => {
    const {rerender} = render(createElement(Parent, {}));
    expect(renderCount).toBe(1);

    act(() => {
      vi.advanceTimersByTime(300); // usePlayback's initial kickoff delay
      vi.advanceTimersByTime(100 * 3); // step through a few beats
    });
    const turnBeforeRerender = latest!.view.turn;
    expect(turnBeforeRerender).toBeGreaterThan(0);

    // The parent re-renders (e.g. a background prefetch dispatch elsewhere
    // in the app) — teams/beats are unchanged, but Parent's onDone closure
    // is a new function reference every time IT renders, same as production.
    act(() => {
      rerender(createElement(Parent, {}));
    });
    expect(renderCount).toBe(2);

    expect(latest!.view.turn).toBe(turnBeforeRerender);
    expect(latest!.view.logLines.length).toBeGreaterThan(0);
  });

  it('keeps advancing turns and still calls onDone at the end, even with repeated unrelated re-renders', () => {
    const {rerender} = render(createElement(Parent, {}));

    // A parent re-render lands after every single beat — the worst case for
    // the ref-based design. If it were subtly wrong (finish/step unstable,
    // or the reset effect firing), this would either wipe progress every
    // beat or silently miss the final onDone; both are asserted below.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    for (let i = 0; i < BEATS.length; i++) {
      act(() => {
        rerender(createElement(Parent, {}));
        vi.advanceTimersByTime(100);
      });
    }
    // Flush the final `finish()` call scheduled by the last step.
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(renderCount).toBeGreaterThan(1);
    expect(latest!.view.turn).toBe(BEATS.length);
    expect(latest!.done).toBe(true);
    expect(doneCallCount).toBe(1);
  });

  it('continues through a GROWING beats array without restarting (streaming)', () => {
    const first = beatsOf(3);
    const {rerender} = render(createElement(Parent, {beats: first, opts: {streamDone: false, battleKey: 0}}));

    act(() => {
      vi.advanceTimersByTime(300 + 100 * 2); // play 2 of the 3 known beats
    });
    const midTurn = latest!.view.turn;
    expect(midTurn).toBeGreaterThan(0);

    // Five more beats stream in: NEW array identity, same battle.
    const grown = [...first, ...beatsOf(5, 3)];
    act(() => {
      rerender(createElement(Parent, {beats: grown, opts: {streamDone: false, battleKey: 0}}));
      vi.advanceTimersByTime(100 * 6);
    });
    // Progress continued INTO the new beats — no snap back to turn 0.
    expect(latest!.view.turn).toBeGreaterThan(midTurn);
    expect(latest!.done).toBe(false);
  });

  it('parks when it catches the stream, resumes on growth, finishes when the stream ends', () => {
    const first = beatsOf(2);
    const {rerender} = render(createElement(Parent, {beats: first, opts: {streamDone: false, battleKey: 0}}));

    act(() => {
      vi.advanceTimersByTime(300 + 100 * 2 + 1); // play both known beats
    });
    expect(latest!.view.turn).toBe(2);
    expect(latest!.waiting).toBe(true); // caught up: parked, not done
    expect(latest!.done).toBe(false);
    expect(doneCallCount).toBe(0);

    const grown = [...first, ...beatsOf(2, 2)];
    // Two acts: the resume effect (which re-enters step) flushes at act-scope
    // end, so the timer advance must come in a LATER act than the rerender.
    act(() => {
      rerender(createElement(Parent, {beats: grown, opts: {streamDone: false, battleKey: 0}}));
    });
    act(() => {
      vi.advanceTimersByTime(100 * 2 + 1);
    });
    expect(latest!.view.turn).toBe(4);
    expect(latest!.waiting).toBe(true); // caught up again

    // The stream ends with no further beats (e.g. that WAS the last turn).
    act(() => {
      rerender(createElement(Parent, {beats: grown, opts: {streamDone: true, battleKey: 0}}));
    });
    expect(latest!.done).toBe(true);
    expect(doneCallCount).toBe(1);
  });

  it('restarts on a battleKey change, not on beats identity alone', () => {
    const {rerender} = render(createElement(Parent, {beats: BEATS, opts: {streamDone: true, battleKey: 0}}));
    act(() => {
      vi.advanceTimersByTime(300 + 100 * 4);
    });
    expect(latest!.view.turn).toBeGreaterThanOrEqual(4);

    // Same-length copy (new identity) — must NOT restart.
    act(() => {
      rerender(createElement(Parent, {beats: [...BEATS], opts: {streamDone: true, battleKey: 0}}));
    });
    expect(latest!.view.turn).toBeGreaterThanOrEqual(4);

    // New rung — must restart from the top.
    act(() => {
      rerender(createElement(Parent, {beats: [...BEATS], opts: {streamDone: true, battleKey: 1}}));
    });
    expect(latest!.view.turn).toBe(0);
  });

  it('caps speed at 5x, honors (but never persists) a larger dev override', () => {
    expect(MAX_SPEED).toBe(5);
    render(createElement(Parent, {beats: BEATS, opts: {streamDone: true, battleKey: 0, speedOverride: 30}}));
    expect(latest!.speed).toBe(30); // the override itself is honored
    act(() => {
      latest!.setSpeed(30);
    });
    expect(latest!.speed).toBe(30);
    expect(loadSpeed()).toBeLessThanOrEqual(MAX_SPEED); // persistence stays capped

    cleanup();
    render(createElement(Parent, {beats: BEATS, opts: {streamDone: true, battleKey: 0}}));
    act(() => {
      latest!.setSpeed(10); // no override: clamped to the cap
    });
    expect(latest!.speed).toBe(MAX_SPEED);
  });
});
