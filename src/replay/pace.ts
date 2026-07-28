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

/** Extra hold on a big hit (crit / super-effective) so it lands visually. */
export const BIG_HIT_BONUS_MS = 150;

/**
 * Extra time a beat needs for each textbox page beyond its first.
 *
 * The message box shows one line at a time now, the way the handheld games
 * do: "Hariyama used Bullet Punch!" types out, holds, then gives way to
 * "It's super effective!". Both used to be printed at once, before the hit
 * had even landed. A beat that has to speak twice needs room to, or the
 * second page gets cut off by the next beat.
 */
export const PAGE_MS = 550;

/** How many textbox pages a beat's events will produce. */
export function pageCount(events: ReplayEvent[]): number {
  return events.reduce((n, event) => {
    const recall = event.kind === 'switch' && event.recallText ? 1 : 0;
    return n + recall + ('logText' in event && event.logText ? 1 : 0);
  }, 0);
}

/**
 * How long the HP bar takes to drain.
 *
 * The handheld games drain at a constant RATE, not in a constant time, which
 * is most of why a near-knockout feels heavier than a chip: you watch the bar
 * fall for a full second. A flat 0.4s transition made a 5% Life Orb tick and a
 * 90% Earthquake read as exactly the same event.
 *
 * Clamped at both ends: below the floor the bar just twitches and the
 * animation is wasted, and above the ceiling the drain outlives its own beat.
 */
export const DRAIN_FULL_BAR_MS = 1400;
export const DRAIN_MIN_MS = 180;
export const DRAIN_MAX_MS = 1000;

/** `deltaFrac` is a fraction of max HP (0..1); `speed` is the playback
 * multiplier, so a drain still fits its beat when the slider is at 5x. */
export function drainMs(deltaFrac: number, speed = 1): number {
  const raw = Math.abs(deltaFrac) * DRAIN_FULL_BAR_MS;
  const clamped = Math.min(DRAIN_MAX_MS, Math.max(DRAIN_MIN_MS, raw));
  return Math.round(clamped / Math.max(speed, 0.1));
}

/** Roughly a glyph a frame, which is what the handheld games' "fast" text
 * speed works out to. */
export const TYPE_MS_PER_CHAR = 18;
/** Never spend more than this share of a page's time typing — the rest is the
 * hold that lets you actually read it before the next page turns. */
export const TYPE_SHARE_OF_PAGE = 0.55;
/** Below roughly a quarter of a frame per glyph, don't type at all: the reveal
 * is invisible as motion and the beat ends mid-word. */
export const MIN_TYPE_MS_PER_CHAR = 4;

export interface TypePlan {
  /** Print the whole line at once — the page is too short to type inside. */
  instant: boolean;
  /** Interval between reveals, never below a frame. */
  tick: number;
  /** Glyphs revealed per tick. */
  step: number;
  /** How long the reveal will actually take. */
  totalMs: number;
  /** What is left of the page once it has finished typing — the hold before
   * the page turns. Derived rather than a fixed fraction, so the tick
   * quantisation (a last tick that reveals one glyph still costs a whole
   * frame) can never push a page past the end of its beat. */
  holdMs: number;
}

/**
 * How to reveal one textbox page inside the time that page actually has.
 *
 * The invariant that matters, and that `typePlanFits` asserts: the reveal must
 * finish inside its share of the beat. Getting this wrong is not cosmetic —
 * the next beat replaces the box, so an overrunning page is one the reader
 * never sees. It bit twice: once because the per-page budget was clamped to a
 * 120ms floor larger than the beat itself at 5x, and once because rounding the
 * glyphs-per-tick DOWN to 1 made the reveal slower than the budget it was
 * computed from.
 */
export function typePlan(pageMs: number, chars: number, speed = 1): TypePlan {
  const page = Math.max(1, pageMs);
  const budget = (page * TYPE_SHARE_OF_PAGE) / Math.max(1, chars);
  if (budget < MIN_TYPE_MS_PER_CHAR) {
    return {instant: true, tick: 0, step: chars, totalMs: 0, holdMs: page};
  }
  const perChar = Math.min(TYPE_MS_PER_CHAR / Math.max(speed, 0.1), budget);
  const tick = Math.max(16, perChar);
  // `ceil`: nothing ticks faster than a frame, so a sub-16ms per-char time is
  // paid for by revealing several glyphs at once. Rounding down would make the
  // reveal slower than the budget it was derived from.
  const step = Math.max(1, Math.ceil(tick / perChar));
  const totalMs = Math.ceil(chars / step) * tick;
  return {instant: false, tick, step, totalMs, holdMs: Math.max(0, page - totalMs)};
}

/** Does this page finish typing AND holding inside its own slice of the beat?
 * The next beat replaces the box, so a page that overruns is a page nobody
 * reads. */
export function typePlanFits(pageMs: number, chars: number, speed = 1): boolean {
  const plan = typePlan(pageMs, chars, speed);
  return plan.totalMs + plan.holdMs <= Math.max(1, pageMs) + 1;
}

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
      // Crits and super-effective hits get a slightly longer hold — the tags
      // are populated during parsing, before beats are built.
      const bigHit = event.tags.crit || event.tags.supereffective;
      beats.push({
        events: group,
        durationMs:
          PACE.move +
          (bigHit ? BIG_HIT_BONUS_MS : 0) +
          Math.max(0, pageCount(group) - 1) * PAGE_MS,
      });
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
    // A switch speaks twice ("come back!" then "Go!"), so it needs the same
    // per-page allowance a multi-line move beat does.
    beats.push({events: [event], durationMs: duration + Math.max(0, pageCount([event]) - 1) * PAGE_MS});
    i++;
  }
  return beats;
}
