import type {ReplayEvent} from './parse';

/** A group of events presented together, then a pause. */
export interface Beat {
  events: ReplayEvent[];
  durationMs: number;
}

/** Per-beat pause at 1x speed (2x halves; instant = 0). */
export const PACE = {
  turn: 400,
  switch: 900,
  move: 1200,
  residual: 700,
  heal: 600,
  faint: 1000,
  status: 600,
  boost: 600,
  weather: 600,
  field: 600,
  side: 600,
  tera: 1000,
  cant: 500,
  note: 350,
  win: 1500,
} as const;

/**
 * Group events into presentation beats: a move plus its immediate
 * consequences (direct damage, effectiveness notes) lands as ONE beat so
 * the lunge, HP drain, and floating number read as a single action;
 * residual/hazard damage, faints, and state changes get their own beats.
 */
export function toBeats(events: ReplayEvent[]): Beat[] {
  const beats: Beat[] = [];
  let i = 0;

  while (i < events.length) {
    const event = events[i];

    if (event.kind === 'move') {
      const group: ReplayEvent[] = [event];
      let j = i + 1;
      while (j < events.length) {
        const next = events[j];
        const isDirectDamage = next.kind === 'damage' && !next.from && next.sourceMove?.move === event.move;
        const isAnnotation =
          next.kind === 'note' &&
          ['crit', 'supereffective', 'resisted', 'miss', 'immune'].includes(next.text);
        if (isDirectDamage || isAnnotation) {
          group.push(next);
          j++;
        } else break;
      }
      beats.push({events: group, durationMs: PACE.move});
      i = j;
      continue;
    }

    const duration =
      event.kind === 'damage'
        ? PACE.residual
        : event.kind === 'turn'
          ? PACE.turn
          : event.kind === 'switch'
            ? PACE.switch
            : (PACE as Record<string, number>)[event.kind] ?? PACE.note;
    beats.push({events: [event], durationMs: duration});
    i++;
  }
  return beats;
}
