import {useCallback, useEffect, useRef, useState} from 'react';
import type {PokemonSet} from '../../data/types';
import {applyBeat, foldBeats, initView, type FxItem, type ViewState} from '../../replay/view';
import type {Beat} from '../../replay/pace';

export type PlaybackSpeed = 1 | 2 | 'instant';

export interface Playback {
  view: ViewState;
  fx: FxItem[];
  /** Monotonic key so identical consecutive fx retrigger CSS animations. */
  fxKey: number;
  /**
   * Log lines pushed by the CURRENT beat — the on-stage message box text.
   * Empty after instant/skip (the box then falls back to the last log line).
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
 * 1x uses each beat's paced duration, 2x halves it, instant folds the rest
 * synchronously. Presentation only — the battle is already computed.
 */
export function usePlayback(
  teams: [PokemonSet[], PokemonSet[]] | undefined,
  beats: Beat[] | undefined,
  onDone: () => void
): Playback {
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
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
  speedRef.current = speed;

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setDone(true);
    onDone();
  }, [onDone]);

  const step = useCallback(() => {
    if (!beats || !viewRef.current) return;
    const index = indexRef.current;
    if (index >= beats.length) {
      finish();
      return;
    }
    if (speedRef.current === 'instant') {
      viewRef.current = foldBeats(viewRef.current, beats, index);
      indexRef.current = beats.length;
      setView(viewRef.current);
      setFx([]);
      setCaption([]);
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
    timerRef.current = setTimeout(step, beat.durationMs / (speedRef.current === 2 ? 2 : 1));
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

  const changeSpeed = useCallback(
    (next: PlaybackSpeed) => {
      setSpeed(next);
      if (next === 'instant') skipToEnd();
    },
    [skipToEnd]
  );

  return {
    view: view ?? initView(teams ?? [[], []]),
    fx,
    fxKey,
    caption,
    speed,
    setSpeed: changeSpeed,
    skipToEnd,
    done,
    progress: beats?.length ? indexRef.current / beats.length : 0,
  };
}
