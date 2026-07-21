// @vitest-environment jsdom
import {createElement, useEffect} from 'react';
import {act, cleanup, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {usePlayback, type Playback} from '../../src/app/sixoh/usePlayback';
import type {Beat} from '../../src/replay/pace';
import {makeSet} from '../engine/helpers';

/**
 * Reproduces (and proves the fix for) the "battle resets mid-playback" bug:
 * SixOhGauntlet.tsx passes `onDone={() => dispatch(...)}` to BattleStage — a
 * fresh closure every time the PARENT screen re-renders (e.g. a background
 * rung-prefetch resolving while this battle is still replaying). Before the
 * fix, usePlayback's `finish`/`step` were built via useCallback keyed on
 * `onDone` directly, and the progress-reset effect was keyed on `step` — so
 * an unrelated parent re-render silently wiped the in-progress battle back to
 * turn 0. The fix reads `onDone` through a ref instead, so `finish`/`step`
 * stay referentially stable across those renders regardless of whether the
 * caller bothers to memoize its callback.
 *
 * Two components, matching the real parent/child boundary: `Inner` is
 * BattleStage (calls usePlayback; its OWN beat-driven state updates must
 * NOT recreate `onDone`, since React never re-invokes a parent just because
 * a child updates its own state). `Parent` is SixOhGauntlet — only an
 * explicit re-render of Parent (the `rerender()` call below) should produce
 * a new onDone closure.
 */

const TEAMS: [ReturnType<typeof makeSet>[], ReturnType<typeof makeSet>[]] = [
  [makeSet('Pikachu', ['Thunderbolt'])],
  [makeSet('Bulbasaur', ['Tackle'])],
];
const BEATS: Beat[] = Array.from({length: 8}, (_, i) => ({
  events: [{kind: 'turn' as const, turn: i + 1}],
  durationMs: 100,
}));

let latest: Playback | undefined;
let renderCount = 0;
let doneCallCount = 0;

function Inner({onDone}: {onDone: () => void}) {
  const playback = usePlayback(TEAMS, BEATS, onDone);
  useEffect(() => {
    latest = playback;
  });
  return null;
}

/** Mirrors SixOhGauntlet: a fresh onDone closure every time PARENT itself
 *  renders — not on Inner's own beat-driven re-renders. */
function Parent() {
  renderCount++;
  const onDone = () => {
    doneCallCount++;
  };
  return createElement(Inner, {onDone});
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
    const {rerender} = render(createElement(Parent));
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
      rerender(createElement(Parent));
    });
    expect(renderCount).toBe(2);

    expect(latest!.view.turn).toBe(turnBeforeRerender);
    expect(latest!.view.logLines.length).toBeGreaterThan(0);
  });

  it('keeps advancing turns and still calls onDone at the end, even with repeated unrelated re-renders', () => {
    const {rerender} = render(createElement(Parent));

    // A parent re-render lands after every single beat — the worst case for
    // the ref-based fix. If the fix were subtly wrong (e.g. finish/step still
    // captured a stale onDone, or the reset effect fired), this would either
    // wipe progress every beat (turn would never exceed 1) or onDone would
    // never fire because a stale finish closure keeps calling the FIRST
    // render's onDone forever — that's harmless here since every Parent
    // render's onDone increments the same shared counter, so the real risk is
    // silently missing the call entirely, which the doneCallCount assertion
    // below catches.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    for (let i = 0; i < BEATS.length; i++) {
      act(() => {
        rerender(createElement(Parent));
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
});
