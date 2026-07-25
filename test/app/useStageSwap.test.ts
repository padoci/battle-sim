// @vitest-environment jsdom
import {createElement, useEffect} from 'react';
import {act, cleanup, render} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {SWAP_FADE_MS, swapOutDelayMs, useStageSwap} from '../../src/app/sixoh/useStageSwap';

let latest: ReturnType<typeof useStageSwap>;

function Probe({index, enabled}: {index: number; enabled: boolean}) {
  const swap = useStageSwap(index, enabled);
  useEffect(() => {
    latest = swap;
  });
  latest = swap;
  return null;
}

describe('swapOutDelayMs', () => {
  it('leaves room for the full fade when the beat is long enough', () => {
    // 1500ms win beat at 1x: dip starts with the fade's length to spare.
    expect(swapOutDelayMs(1500)).toBe(1500 - SWAP_FADE_MS);
  });

  it('clamps the fade to half the beat when the beat is short', () => {
    // At 5x the win beat is 300ms. An unclamped 350ms fade would outlive it,
    // so the advance would land mid-fade and the page-height change (the log
    // and controls unmounting) would pop at partial opacity.
    expect(swapOutDelayMs(300)).toBe(150);
    expect(swapOutDelayMs(400)).toBe(200);
  });

  it('never returns a negative delay', () => {
    expect(swapOutDelayMs(0)).toBe(0);
  });
});

describe('useStageSwap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('starts un-dipped and dips when asked', () => {
    render(createElement(Probe, {index: 0, enabled: true}));
    expect(latest.swapClass).toBe('stage-swap');

    act(() => latest.beginSwapOut());
    expect(latest.swapClass).toBe('stage-swap swapping');
    expect(latest.swappingOut).toBe(true);
  });

  it('comes back in when the rung changes', () => {
    const {rerender} = render(createElement(Probe, {index: 0, enabled: true}));
    act(() => latest.beginSwapOut());
    expect(latest.swappingOut).toBe(true);

    // The next rung has mounted underneath the wrapper.
    act(() => {
      rerender(createElement(Probe, {index: 1, enabled: true}));
    });
    expect(latest.swappingOut).toBe(false);
    expect(latest.swapClass).toBe('stage-swap');
  });

  it('is inert under reduced motion', () => {
    // These users keep the hard cut. Dipping via CSS `transition: none` would
    // snap them straight to opacity 0, which is worse than the cut.
    render(createElement(Probe, {index: 0, enabled: false}));
    act(() => latest.beginSwapOut());
    expect(latest.swappingOut).toBe(false);
    expect(latest.swapClass).toBe('stage-swap');
  });

  it('keeps a stable callback identity across re-renders', () => {
    // The stage arms a timer in an effect keyed on this callback. A fresh
    // identity every render (a background rung prefetch resolving, say) would
    // re-arm the timer from full duration each time and the dip would never
    // land.
    const {rerender} = render(createElement(Probe, {index: 0, enabled: true}));
    const first = latest.beginSwapOut;
    rerender(createElement(Probe, {index: 0, enabled: true}));
    expect(latest.beginSwapOut).toBe(first);
  });
});
