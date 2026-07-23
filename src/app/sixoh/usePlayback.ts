import {useCallback, useEffect, useRef, useState} from 'react';
import type {PokemonSet} from '../../data/types';
import {applyBeat, initView, type FxItem, type ViewState} from '../../replay/view';
import type {Beat} from '../../replay/pace';

/** Continuous replay-speed multiplier (ui-spec §6a): 0.1x (slow-mo) to 5x.
 * Capped at 5x so playback can never outrun a streaming search by much. */
export type PlaybackSpeed = number;

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 5;
const DEFAULT_SPEED = 1;
const SPEED_KEY = 'battlesim.playbackSpeed';

/** Fixed (not speed-scaled) settle pause before the very first beat plays —
 * just enough for the stage to mount, not a paced beat. */
const KICKOFF_MS = 80;
/** Fixed (not speed-scaled) gap between beats still inside the pre-turn-1
 * preamble (the two turn-0 lead switch-ins): short and constant regardless
 * of playback speed, so both leads land close together instead of the
 * second one lagging the paced `PACE.switch` wait behind the first. */
const LEAD_IN_GAP_MS = 150;

/** Slider position (0..1) <-> speed, log-mapped so the 0.5x-3x band most
 * users live in owns the middle of the track and 1x sits near center. */
export function speedToPosition(speed: PlaybackSpeed): number {
  return Math.log(speed / MIN_SPEED) / Math.log(MAX_SPEED / MIN_SPEED);
}

export function positionToSpeed(position: number): PlaybackSpeed {
  const clamped = Math.min(1, Math.max(0, position));
  const raw = MIN_SPEED * (MAX_SPEED / MIN_SPEED) ** clamped;
  return Math.round(raw * 10) / 10;
}

/** The persisted playback speed. Exported so the battle intro (which runs
 * before usePlayback mounts) paces its hold time by the same multiplier.
 * Out-of-range stored values are clamped (a 10x persisted by an older build
 * lands on today's 5x cap), not reset to the default. */
export function loadSpeed(): PlaybackSpeed {
  try {
    const raw = Number(localStorage.getItem(SPEED_KEY));
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SPEED;
    return Math.min(MAX_SPEED, Math.max(MIN_SPEED, raw));
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
  /** Playback has consumed every known beat but the stream is still
   * producing more — parked, message box holding, no timer running. */
  waiting: boolean;
  done: boolean;
  progress: number; // 0..1 through the beats known so far
}

export interface PlaybackOpts {
  /** True once the full battle result exists — no more beats will arrive. */
  streamDone: boolean;
  /** Battle identity (rung index). Playback restarts ONLY when this or
   * `teams` changes — never on beats-array identity, which grows per
   * streamed decision. */
  battleKey: number | string;
  /** Dev/e2e ?speed= override: initial speed, may exceed MAX_SPEED. */
  speedOverride?: number;
}

/**
 * Drives a beat timeline with a setTimeout chain (ui-spec §6a playback):
 * each beat's paced duration is divided by the speed multiplier.
 * Presentation only — but the battle may still be COMPUTING behind it: the
 * beats array grows as the search streams decisions, so playback parks when
 * it catches up and resumes as more arrive. Completion means the stream is
 * done AND every known beat has played.
 */
export function usePlayback(
  teams: [PokemonSet[], PokemonSet[]] | undefined,
  beats: Beat[] | undefined,
  onDone: () => void,
  opts: PlaybackOpts
): Playback {
  const [speed, setSpeedState] = useState<PlaybackSpeed>(() => opts.speedOverride ?? loadSpeed());
  const [view, setView] = useState<ViewState | undefined>();
  const [fx, setFx] = useState<FxItem[]>([]);
  const [fxKey, setFxKey] = useState(0);
  const [caption, setCaption] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const speedRef = useRef<PlaybackSpeed>(speed);
  const viewRef = useRef<ViewState | undefined>();
  const doneRef = useRef(false);
  const waitingRef = useRef(false);
  const onDoneRef = useRef(onDone);
  // beats/streamDone are read through refs so `step` never closes over them:
  // the array's identity changes on EVERY streamed chunk, and a step keyed
  // on it would cascade into the restart effect (see the comment below).
  const beatsRef = useRef(beats);
  const streamDoneRef = useRef(opts.streamDone);
  speedRef.current = speed;
  onDoneRef.current = onDone;
  beatsRef.current = beats;
  streamDoneRef.current = opts.streamDone;

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
    const currentBeats = beatsRef.current;
    if (!currentBeats || !viewRef.current) {
      // Stream hasn't produced its first chunk yet: park until it does.
      if (viewRef.current) return;
      waitingRef.current = true;
      setWaiting(true);
      return;
    }
    const index = indexRef.current;
    if (index >= currentBeats.length) {
      // Caught up. Done only if the stream is; otherwise park (no timer) —
      // the resume effect below re-enters when more beats land.
      if (streamDoneRef.current) {
        finish();
      } else {
        waitingRef.current = true;
        setWaiting(true);
      }
      return;
    }
    const beat = currentBeats[index];
    const spokenBefore = viewRef.current.logLines.length;
    const applied = applyBeat(viewRef.current, beat);
    viewRef.current = applied.state;
    indexRef.current = index + 1;
    setView(applied.state);
    setFx(applied.fx);
    setFxKey(k => k + 1);
    setCaption(applied.state.logLines.slice(spokenBefore));
    // Still in the pre-turn-1 preamble (typically the two turn-0 lead
    // switch-ins): a short fixed gap instead of the full paced beat duration,
    // so both leads land close together at any speed.
    const delay = applied.state.turn === 0 ? LEAD_IN_GAP_MS : beat.durationMs / speedRef.current;
    timerRef.current = setTimeout(step, delay);
  }, [finish]);

  // (Re)start ONLY on a new battle (teams/battleKey), never on beats
  // identity — a streamed battle's beats array is replaced on every chunk,
  // and restarting there would snap the replay back to turn 0 (the exact
  // bug the ref-reading design above exists to prevent).
  useEffect(() => {
    if (!teams) return;
    indexRef.current = 0;
    doneRef.current = false;
    waitingRef.current = false;
    setDone(false);
    setWaiting(false);
    viewRef.current = initView(teams);
    setView(viewRef.current);
    setFx([]);
    setCaption([]);
    timerRef.current = setTimeout(step, KICKOFF_MS);
    return () => clearTimeout(timerRef.current);
  }, [teams, opts.battleKey, step]);

  // Resume from the parked state the moment the stream grows (or ends
  // exactly at the parked index, e.g. a maxTurns draw).
  const beatCount = beats?.length ?? 0;
  useEffect(() => {
    if (doneRef.current || !waitingRef.current) return;
    if (beats && indexRef.current < beats.length) {
      waitingRef.current = false;
      setWaiting(false);
      step(); // the paced delay already elapsed while parked
    } else if (opts.streamDone) {
      finish();
    }
  }, [beatCount, opts.streamDone, beats, step, finish]);

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
    if (doneRef.current || waitingRef.current) return; // parked: no wait to re-arm
    const pendingBeat = beatsRef.current?.[indexRef.current - 1];
    if (!pendingBeat) return;
    clearTimeout(timerRef.current);
    // Still in the turn-0 preamble: its gap is fixed, not speed-scaled (see
    // step()) — leave it alone rather than re-arming at the paced duration.
    const delay = viewRef.current?.turn === 0 ? LEAD_IN_GAP_MS : pendingBeat.durationMs / speed;
    timerRef.current = setTimeout(step, delay);
  }, [speed, step]);

  const setSpeed = useCallback((next: PlaybackSpeed) => {
    // The dev/e2e override may exceed the UI cap; never persist beyond it.
    const cap = Math.max(MAX_SPEED, opts.speedOverride ?? 0);
    const clamped = Math.min(cap, Math.max(MIN_SPEED, next));
    setSpeedState(clamped);
    saveSpeed(Math.min(clamped, MAX_SPEED));
  }, [opts.speedOverride]);

  return {
    view: view ?? initView(teams ?? [[], []]),
    fx,
    fxKey,
    caption,
    speed,
    setSpeed,
    waiting,
    done,
    progress: beats?.length ? indexRef.current / beats.length : 0,
  };
}
