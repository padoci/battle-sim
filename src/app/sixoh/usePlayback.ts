import {useCallback, useEffect, useRef, useState} from 'react';
import type {PokemonSet} from '../../data/types';
import {applyBeat, foldBeats, initView, type FxItem, type ViewState} from '../../replay/view';
import type {Beat} from '../../replay/pace';

/** Continuous replay-speed multiplier (ui-spec §6a): 0.1x (slow-mo) to 10x
 * (near-instant — beat delays shrink to a few ms, so it *reads* as instant
 * without a special-cased fold branch). */
export type PlaybackSpeed = number;

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 10;
const DEFAULT_SPEED = 2;
const SPEED_KEY = 'battlesim.playbackSpeed';

function loadSpeed(): PlaybackSpeed {
  try {
    const raw = Number(localStorage.getItem(SPEED_KEY));
    return raw >= MIN_SPEED && raw <= MAX_SPEED ? raw : DEFAULT_SPEED;
  } catch {
    return DEFAULT_SPEED;
  }
}

function saveSpeed(speed: PlaybackSpeed): void {
  try {
    localStorage.setItem(SPEED_KEY, String(speed));
  } catch {
    // Storage unavailable (private mode, sandboxed test env) — speed just
    // won't persist across reloads.
  }
}

export interface Playback {
  view: ViewState;
  fx: FxItem[];
  /** Monotonic key so identical consecutive fx retrigger CSS animations. */
  fxKey: number;
  /**
   * Log lines pushed by the CURRENT beat — the on-stage message box text.
   * Empty after a skip (the box then falls back to the last log line).
   */
  caption: string[];
  speed: PlaybackSpeed;
  setSpeed: (speed: PlaybackSpeed) => void;
  skipToEnd: () => void;
  done: boolean;
  progress: number; // 0..1 through the beats
}

/**
 * Drives a beat timeline with a setTimeout chain (ui-spec §6a playback):
 * each beat's paced duration is divided by the speed multiplier. Presentation
 * only — the battle is already computed.
 */
export function usePlayback(
  teams: [PokemonSet[], PokemonSet[]] | undefined,
  beats: Beat[] | undefined,
  onDone: () => void
): Playback {
  const [speed, setSpeedState] = useState<PlaybackSpeed>(loadSpeed);
  const [view, setView] = useState<ViewState | undefined>();
  const [fx, setFx] = useState<FxItem[]>([]);
  const [fxKey, setFxKey] = useState(0);
  const [caption, setCaption] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const speedRef = useRef<PlaybackSpeed>(speed);
  const viewRef = useRef<ViewState | undefined>();
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  speedRef.current = speed;
  onDoneRef.current = onDone;

  // Read via a ref rather than closing over `onDone` directly: callers
  // routinely pass an inline callback that gets a new identity on every
  // render (e.g. SixOhGauntlet re-rendering because an unrelated background
  // rung-prefetch resolved while this battle is still replaying). If `finish`
  // depended on `onDone`, that unrelated re-render would recreate `finish`,
  // then `step` (which depends on `finish`), then retrigger the (re)start
  // effect below (keyed on `step`) — silently wiping the in-progress battle
  // back to turn 0. Reading the latest callback through a ref keeps `finish`
  // (and therefore `step`) stable across those renders.
  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setDone(true);
    onDoneRef.current();
  }, []);

  const step = useCallback(() => {
    if (!beats || !viewRef.current) return;
    const index = indexRef.current;
    if (index >= beats.length) {
      finish();
      return;
    }
    const beat = beats[index];
    const spokenBefore = viewRef.current.logLines.length;
    const applied = applyBeat(viewRef.current, beat);
    viewRef.current = applied.state;
    indexRef.current = index + 1;
    setView(applied.state);
    setFx(applied.fx);
    setFxKey(k => k + 1);
    setCaption(applied.state.logLines.slice(spokenBefore));
    timerRef.current = setTimeout(step, beat.durationMs / speedRef.current);
  }, [beats, finish]);

  // (Re)start when a new battle's beats arrive.
  useEffect(() => {
    if (!teams || !beats) return;
    indexRef.current = 0;
    doneRef.current = false;
    setDone(false);
    viewRef.current = initView(teams);
    setView(viewRef.current);
    setFx([]);
    setCaption([]);
    timerRef.current = setTimeout(step, 300);
    return () => clearTimeout(timerRef.current);
  }, [teams, beats, step]);

  // A speed change should be felt right away, not just from the next beat
  // onward: `step` schedules its timeout using the speed at THAT moment, so
  // without this a pending wait keeps running at the old speed — e.g. crank
  // 0.1x up to 10x mid-beat and it'd still take the full 0.1x-paced delay to
  // respond. Re-arm the in-flight wait (from its full paced duration, not a
  // precisely interpolated remainder — simple, and the worst case is now one
  // beat at the NEW speed instead of one at the old one) whenever speed
  // changes mid-battle.
  // Deliberately keyed on `speed` alone — `beats` changing is the battle
  // (re)start effect's job (which already resets indexRef to 0, making this
  // one a no-op for that render).
  useEffect(() => {
    if (!beats || doneRef.current) return;
    const pendingBeat = beats[indexRef.current - 1];
    if (!pendingBeat) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(step, pendingBeat.durationMs / speed);
  }, [speed]);

  const skipToEnd = useCallback(() => {
    clearTimeout(timerRef.current);
    if (!beats || !viewRef.current) return;
    viewRef.current = foldBeats(viewRef.current, beats, indexRef.current);
    indexRef.current = beats.length;
    setView(viewRef.current);
    setFx([]);
    setCaption([]);
    finish();
  }, [beats, finish]);

  const setSpeed = useCallback((next: PlaybackSpeed) => {
    const clamped = Math.min(MAX_SPEED, Math.max(MIN_SPEED, next));
    setSpeedState(clamped);
    saveSpeed(clamped);
  }, []);

  return {
    view: view ?? initView(teams ?? [[], []]),
    fx,
    fxKey,
    caption,
    speed,
    setSpeed,
    skipToEnd,
    done,
    progress: beats?.length ? indexRef.current / beats.length : 0,
  };
}
