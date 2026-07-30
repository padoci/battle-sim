import {useCallback, useEffect, useMemo, useRef, useState, type CSSProperties} from 'react';
import {Icons, Sprites} from '@pkmn/img';
import type {PokemonSet} from '../../data/types';
import {parseProtocol} from '../../replay/parse';
import {drainMs, PACE, toBeats, typePlan} from '../../replay/pace';
import type {FxItem, MonView, SideView} from '../../replay/view';
import {navigate} from '../router';
import {useUnloadGuard} from '../useUnloadGuard';
import {readDevParams} from '../sixoh/devParams';
import {HIT_DELAY, signatureSlug} from '../sixoh/fx';
import {BATTLE_SCENES, sceneUrl} from '../sixoh/scenes';
import {FIELD_CLASSES, useFxRestart} from '../sixoh/useFxRestart';
import {useStageGeometry} from '../sixoh/useStageGeometry';
import {swapFadeMs, swapOutDelayMs, useStageSwap} from '../sixoh/useStageSwap';
import {ensureComputed, resetSixOhSession, retryBattle} from '../sixoh/session';
import {useSixOhDispatch, useSixOhState, type GauntletOpponent} from '../sixoh/state';
import {typeColor} from '../sixoh/typeColors';
import {loadSpeed, positionToSpeed, speedToPosition, usePlayback} from '../sixoh/usePlayback';
import {TrainerPortrait} from '../components/TrainerPortrait';
import type {DraftMode} from '../../draft/draft';

/** The 2D-animated set (`gen5ani`) only covers Gen 1-5 Pokémon — most Gen 9
 * mons (Great Tusk, Kingambit, Gholdengo…) fall back to the static `gen5`
 * set, and anything with no Gen 5 sprite at all falls back to the box icon.
 * Cached across renders so a mon known to lack gen5ani doesn't re-probe it
 * (and flash a broken image) on every beat. */
const knownMissingGen5Ani = new Set<string>();
type SpriteTier = 'gen5ani' | 'gen5' | 'icon';

/** A stable per-species number, used to offset idle phase so the two mons on
 * the field never breathe in lockstep. */
function speciesPhase(species: string): number {
  let h = 0;
  for (let i = 0; i < species.length; i++) h = (h * 31 + species.charCodeAt(i)) >>> 0;
  return h % 3200;
}

/**
 * `gen5ani` sprites are animated GIFs, which is motion the same way a CSS
 * keyframe is — and unlike a keyframe there is no way to pause one. Under
 * reduced motion we ask for the static `gen5` tier instead, which is the
 * fallback the component already knows how to render.
 *
 * This also makes the stage deterministic to screenshot. The visual tests that
 * opt into reduced motion mask everything moving with the replay clock, but a
 * looping GIF ignores both that and Playwright's `animations: 'disabled'`;
 * once the sprites grew to a third of the frame, the frame-to-frame variation
 * alone was 5-8% of the image against a 3% tolerance, and the shot could never
 * stabilise.
 */
function prefersStillSprites(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function SpriteWithFallback({species, back}: {species: string; back: boolean}) {
  const still = useMemo(prefersStillSprites, []);
  const best = (): SpriteTier => (still || knownMissingGen5Ani.has(species) ? 'gen5' : 'gen5ani');
  const [tier, setTier] = useState<SpriteTier>(best);
  useEffect(() => {
    setTier(best());
    // `best` closes over `species` and `still`; both are in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [species, still]);

  const url =
    tier === 'icon'
      ? undefined
      : Sprites.getPokemon(species, back ? {gen: tier, side: 'p1'} : {gen: tier}).url;
  const inner =
    url === undefined ? (
      <span className="sprite-fallback" style={Icons.getPokemon(species).css} title={species} />
    ) : (
      <img
        key={`${species}-${tier}`}
        className="stage-sprite"
        src={url}
        alt={species}
        onError={() => {
          if (tier === 'gen5ani') knownMissingGen5Ani.add(species);
          setTier(t => (t === 'gen5ani' ? 'gen5' : 'icon'));
        }}
      />
    );

  // Decided by the asset, not by `tier`. Asking @pkmn/img for `gen5ani` on a
  // species that has none returns a static .png rather than erroring, so the
  // tier stays 'gen5ani' and would claim the sprite animates when it does not
  // — which is most of the modern meta.
  const animated = url?.endsWith('.gif') ?? false;

  // The wrapper is a third transform channel. The holder owns the lunge,
  // recoil and KO drop; the sprite itself must stay filter-only because
  // `.sprite-fallback` carries a load-bearing scale(1.7). Idle motion needs
  // somewhere of its own to live, and it composes with the other two.
  //
  // Only the static tiers breathe: `gen5ani` sprites are animated GIFs that
  // already move on their own, and doubling up looks wrong. That is most of
  // the field in practice, since Gen 6+ mons have no gen5ani sprite.
  return (
    <span
      className={animated ? 'sprite-idle' : 'sprite-idle breathing'}
      // A custom property, NOT an inline `animation-delay`. Inline styles beat
      // every stylesheet rule, so a bare delay here applied to whatever
      // animation this wrapper happened to be running — including the KO drop,
      // which also lives on this element. A negative delay longer than
      // faintDrop's 0.75s starts it past its own end, and `fill: forwards`
      // then pins it there: the fainting sprite teleported off the field
      // instead of sliding, for every species whose phase exceeded 750ms.
      style={{'--idle-phase': `-${speciesPhase(species)}ms`} as CSSProperties}
    >
      {inner}
    </span>
  );
}


/**
 * The on-stage textbox.
 *
 * Speaks one line at a time, typing it out and holding it, then moving on:
 * the handheld games never print "Hariyama used Bullet Punch!" and "It's
 * super effective!" on the same page, and never print either of them
 * instantly. `beat.durationMs` is sized to fit `pageCount` pages (see
 * PAGE_MS in replay/pace.ts), so the pages divide the beat evenly and the
 * last one is still readable when the next beat arrives.
 *
 * Its own component so the per-character re-render stays inside this box and
 * never re-renders the stage.
 */
function MessageBox({
  lines,
  beatKey,
  beatMs,
  speed,
}: {
  lines: string[];
  /** Changes once per beat; restarts the page sequence. */
  beatKey: number;
  /** The current beat's full paced duration, already divided by speed. */
  beatMs: number;
  speed: number;
}) {
  const pages = lines.length ? lines : [''];
  const [page, setPage] = useState(0);
  const [shown, setShown] = useState(0);
  // Typing and page-turning are motion, and this is the one piece of it driven
  // by JS timers rather than CSS — `animation: none` cannot reach it, and nor
  // can Playwright's `animations: 'disabled'`, so a visual test would
  // screenshot a different number of revealed characters every run.
  const still = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    []
  );

  const index = Math.min(page, pages.length - 1);
  const text = pages[index] ?? '';
  const perPage = Math.max(1, beatMs) / pages.length;
  // `perPage` is NOT floored to a minimum: clamping it upward is what let the
  // reveal budget exceed the beat that had to contain it. See typePlan.
  const plan = typePlan(perPage, text.length, speed);
  const typing = !still && !plan.instant && shown < text.length;
  const visible = still || plan.instant ? text : text.slice(0, shown);

  useEffect(() => {
    setPage(0);
    setShown(0);
  }, [beatKey]);

  // Reveal on a single interval rather than a timeout per character: at 18ms a
  // 40-character line would otherwise be 40 renders in 700ms. Anything faster
  // than a frame reveals several glyphs per tick instead of ticking faster.
  useEffect(() => {
    if (!typing) return;
    const {tick, step} = plan;
    const timer = setInterval(() => setShown(n => Math.min(text.length, n + step)), tick);
    return () => clearInterval(timer);
  }, [typing, text, plan.tick, plan.step]);

  // Hold the finished page, then turn to the next one.
  useEffect(() => {
    if (still || typing || index >= pages.length - 1) return;
    const timer = setTimeout(() => {
      setPage(p => p + 1);
      setShown(0);
      // Whatever is left of the page after typing, so the quantised reveal
      // can never push the turn past the end of the beat.
    }, plan.holdMs);
    return () => clearTimeout(timer);
  }, [still, typing, index, pages.length, plan.holdMs]);

  // Reduced motion: no typing, no page turns, no blinking prompt — the whole
  // beat is simply printed, which is also what keeps the visual-regression
  // screenshots byte-identical between runs.
  if (still) {
    return (
      <div className="message-box" role="status" aria-live="polite">
        <div className="message-line">{pages.join(' ')}</div>
      </div>
    );
  }

  return (
    <div className="message-box" role="status" aria-live="polite">
      {/* The visible, typed-out page. */}
      <div className="message-line" aria-hidden="true">
        {visible}
      </div>
      {/* Screen readers get every page of the beat at once and unclipped —
          a half-typed sentence re-announced on each keystroke would be
          unusable. */}
      <span className="sr-only">{pages.join(' ')}</span>
      {!typing && index < pages.length - 1 && <span className="message-more" aria-hidden="true" />}
    </div>
  );
}

/** HP meter colour: green > 50%, yellow > 20%, red below.
 *
 * Through the tokens rather than repeating their hex values here: these three
 * are deliberately the same in both themes (they read against the sprites and
 * the pixel-art field, not the chrome), but a second copy in JS would be
 * invisible to any future change to them. */
function hpColor(frac: number): string {
  if (frac > 0.5) return 'var(--hp-high)';
  if (frac > 0.2) return 'var(--hp-mid)';
  return 'var(--hp-low)';
}

/**
 * Count a displayed number toward a new target the way the bar next to it
 * drains: after the same delay, over the same duration, on the same linear
 * curve.
 *
 * The bar's width is a CSS transition, but the readout beside it is text and
 * React sets it the instant the beat applies. Measured over a minute of live
 * battle that left the two disagreeing 21 times, by as much as 100 percentage
 * points for 1.1s — on a knockout the box read "0 / 317" while the bar was
 * still full and the hit had not even landed, which gave the result away
 * before the animation could.
 */
function useCountTo(target: number, delayMs: number, durationMs: number): number {
  const [shown, setShown] = useState(target);
  // Counting is motion, and it is driven by rAF rather than CSS, so neither
  // `animation: none` nor Playwright's `animations: 'disabled'` can reach it.
  const still = useMemo(prefersStillSprites, []);
  // Always ease from what is currently on screen, so an interrupted drain
  // continues from where it got to rather than snapping back.
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    const from = shownRef.current;
    if (still || from === target || durationMs <= 0) {
      setShown(target);
      return;
    }
    let raf = 0;
    let start = 0;
    const step = (now: number) => {
      if (!start) start = now;
      const elapsed = now - start - delayMs;
      if (elapsed < 0) {
        raf = requestAnimationFrame(step);
        return;
      }
      const p = Math.min(1, elapsed / durationMs);
      setShown(Math.round(from + (target - from) * p));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [still, target, delayMs, durationMs]);
  return shown;
}

function HpBar({
  mon,
  side,
  hitDelay,
  drain,
  motion,
  switchDelay,
}: {
  mon: MonView;
  side: 'theirs' | 'mine';
  hitDelay?: string;
  /** Milliseconds this beat's HP change should take to drain, from `drainMs`. */
  drain?: number;
  /** How long the arriving box waits, so it lands with its Pokemon rather than
   * at the top of a beat that is still saying goodbye to the last one. */
  switchDelay?: string;
  /** Slides the box off with the Pokemon leaving, or in with the one arriving.
   * The handheld games move the box with its owner; this used to snap to the
   * incoming mon's name and HP while the outgoing sprite was still on screen. */
  motion?: 'in' | 'out';
}) {
  const frac = mon.maxhp > 0 ? mon.hp / mon.maxhp : 0;
  // The bar's own width and colour stay on the CSS transition; only the text
  // beside them needs counting, and both run linear over the same window.
  const shownHp = useCountTo(mon.hp, parseFloat(hitDelay ?? '0') * 1000, drain ?? 0);
  const shownFrac = mon.maxhp > 0 ? shownHp / mon.maxhp : 0;
  // Matches hpColor's red threshold, so the pulse starts exactly when the bar
  // turns red rather than at some second, invisible cutoff. Driven by the
  // counted value so the klaxon starts as the bar arrives in the red, not as
  // the beat that will eventually take it there begins.
  const critical = shownFrac > 0 && shownFrac <= 0.2;
  const blockStyle: Record<string, string> = {};
  if (hitDelay) blockStyle['--fx-hit-delay'] = hitDelay;
  if (drain !== undefined) blockStyle['--hp-drain'] = `${drain}ms`;
  if (switchDelay) blockStyle['--fx-switch-delay'] = switchDelay;
  return (
    <div
      className={`hp-block ${side}${critical ? ' critical' : ''}${motion ? ` hp-${motion}` : ''}`}
      style={blockStyle as CSSProperties}
    >
      <div className="hp-head">
        <span className="hp-name">{mon.species}</span>
        <span className="mono hp-level">Lv100</span>
        {mon.teraType && <span className="tera-badge" style={{background: typeColor(mon.teraType)}}>Tera {mon.teraType}</span>}
        {mon.status && (
          <span className={`status-chip st-${mon.status}`}>{mon.status.toUpperCase()}</span>
        )}
        {Object.entries(mon.boosts)
          .filter(([, v]) => v !== 0)
          .map(([stat, v]) => (
            <span key={stat} className={`boost-chip ${v > 0 ? 'up' : 'down'}`}>
              {v > 0 ? '+' : ''}{v} {stat}
            </span>
          ))}
      </div>
      <div className="hp-row">
        <span className="hp-hp mono">HP</span>
        <div className="hp-bar">
          <div
            className="hp-fill"
            style={{width: `${Math.max(0, frac * 100)}%`, background: hpColor(frac)}}
          />
        </div>
      </div>
      {/* The real games never show the opponent's exact HP — only the player's box gets a numeric readout. */}
      {side === 'mine' ? (
        <span className="mono hp-numeric">{Math.max(0, shownHp)} / {mon.maxhp}</span>
      ) : (
        <span className="mono hp-label">{Math.round(shownFrac * 100)}%</span>
      )}
    </div>
  );
}

function TeamRow({side, mons}: {side: SideView; mons: PokemonSet[]}) {
  return (
    <div className="team-row">
      {mons.map((set, i) => {
        const view = side.mons.find(m => m.species === set.species);
        return (
          <span
            key={i}
            className={view?.fainted ? 'team-icon fainted' : 'team-icon'}
            style={Icons.getPokemon(set.species).css}
            title={set.species}
          />
        );
      })}
    </div>
  );
}

function FieldStrip({weather, fields, sides}: {weather: string; fields: string[]; sides: [SideView, SideView]}) {
  const tags: string[] = [];
  if (weather) tags.push(weather);
  tags.push(...fields);
  for (const [i, side] of sides.entries()) {
    for (const [hazard, layers] of Object.entries(side.hazards)) {
      tags.push(`${i === 0 ? 'your' : 'their'} side: ${hazard}${layers > 1 ? ` ×${layers}` : ''}`);
    }
    for (const screen of side.screens) tags.push(`${i === 0 ? 'you' : 'them'}: ${screen}`);
  }
  if (!tags.length) return null;
  return (
    <div className="field-strip mono">
      {tags.map((tag, i) => (
        <span key={i} className="field-tag">{tag}</span>
      ))}
    </div>
  );
}

/** One character per hazard layer, drawn in the field corners per side. */
const HAZARD_GLYPHS: Record<string, string> = {
  'Stealth Rock': '▲',
  'Spikes': '✦',
  'Toxic Spikes': '☠',
  'Sticky Web': '⌗',
  'G-Max Steelsurge': '◆',
};

function HazardCorner({side, hazards}: {side: 0 | 1; hazards: Record<string, number>}) {
  const glyphs = Object.entries(hazards).flatMap(([hazard, layers]) =>
    Array.from({length: Math.max(1, layers)}, (_, i) => ({key: `${hazard}-${i}`, hazard}))
  );
  if (!glyphs.length) return null;
  return (
    <div className={`hazard-corner ${side === 0 ? 'mine' : 'theirs'}`} aria-hidden="true">
      {glyphs.map(({key, hazard}) => (
        <span key={key} title={hazard}>{HAZARD_GLYPHS[hazard] ?? '◆'}</span>
      ))}
    </div>
  );
}


/** How the intro announces the opponent, by mode + rung badge. */
function introTitle(opponent: GauntletOpponent, mode: DraftMode): string {
  if (opponent.badge?.includes('Champion')) return `Champion ${opponent.name}`;
  if (mode === 'gymleader') return `Gym Leader ${opponent.name}`;
  return opponent.name;
}

/**
 * What the battle textbox calls the opponent.
 *
 * `introTitle` is right for a one-off "X wants to battle!" banner, but outside
 * Gym Leader mode `opponent.name` is a team archetype — "Hazard Stack Bulky
 * Offense (Iron Moth + Dragonite)" — and a textbox that says that before every
 * single send-out is unreadable, and wraps past the two lines the box has.
 * Those modes have no trainer identity to use instead (avatarKey is unset, see
 * sixoh/state.ts), so the generic form is the honest one.
 */
function foeSpokenName(opponent: GauntletOpponent, mode: DraftMode): string {
  if (opponent.badge?.includes('Champion')) return `Champion ${opponent.name}`;
  if (mode === 'gymleader') return `Gym Leader ${opponent.name}`;
  return 'The opponent';
}

/**
 * The classic handheld battle intro, played full-length before EVERY rung:
 * the opponent's trainer slides onto the (still-empty) field with
 * "X wants to battle!", holds, then slides off into the send-outs. The hold
 * doubles as this battle's loading mask — the send-out can't start until the
 * AI search delivers the replay (`ready`), so a still-computing battle simply
 * holds the entrance (with an honest elapsed readout past a few seconds)
 * instead of showing a bare spinner. Pacing scales with the persisted
 * playback speed; reduced-motion users never see this component at all (the
 * parent falls back to the plain "simulating" panel).
 */
function BattleIntro({
  opponent,
  mode,
  sceneIndex,
  ready,
  speed,
  onDone,
}: {
  opponent: GauntletOpponent;
  mode: DraftMode;
  sceneIndex: number;
  ready: boolean;
  /** Effective pacing multiplier (persisted speed, or the dev override). */
  speed: number;
  onDone: () => void;
}) {
  const [step, setStep] = useState<'enter' | 'hold' | 'leave'>('enter');
  const [elapsed, setElapsed] = useState(0);
  const [spriteBroken, setSpriteBroken] = useState(false);

  // Entrance holds at least this long even when the battle is prefetched, so
  // the intro always reads as a beat rather than a flicker.
  const minEntranceMs = 1600 / speed;
  const leaveMs = 450 / speed;

  useEffect(() => {
    const timer = setTimeout(() => setStep(s => (s === 'enter' ? 'hold' : s)), minEntranceMs);
    return () => clearTimeout(timer);
  }, [minEntranceMs]);

  useEffect(() => {
    if (step === 'hold' && ready) setStep('leave');
  }, [step, ready]);

  useEffect(() => {
    if (step !== 'leave') return;
    const timer = setTimeout(onDone, leaveMs);
    return () => clearTimeout(timer);
  }, [step, leaveMs, onDone]);

  // Elapsed ticker for the searching readout (only surfaces past 3s).
  useEffect(() => {
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const scene = BATTLE_SCENES[((sceneIndex % 4) + 4) % 4];
  return (
    <div className="battle-frame">
      <div className="battle-stage">
        <div className="stage-field intro-field" style={{backgroundImage: `url(${sceneUrl(scene.file)})`}}>
          {opponent.avatarKey && !spriteBroken && (
            <img
              className={`intro-trainer ${step}`}
              src={Sprites.getAvatar(opponent.avatarKey)}
              width={80}
              height={80}
              alt=""
              aria-hidden="true"
              onError={() => setSpriteBroken(true)}
            />
          )}
        </div>
        <div className="message-box" role="status" aria-live="polite">
          <div>{introTitle(opponent, mode)} wants to battle!</div>
          {step === 'hold' && !ready && elapsed >= 3 && (
            <div className="mono intro-searching">both AIs are searching… {elapsed}s</div>
          )}
        </div>
      </div>
    </div>
  );
}


/** FX types that carry a move's type and category, and so decide a holder's
 * accent colour and its `--fx-hit-delay`. A dodge and a block are outcomes of
 * an attack arriving, so they time off the attack exactly as an impact does:
 * leave them out and the defender ducks at beat start, while the beam is still
 * in flight. Module-level because it is an effect dependency downstream. */
const FLAVORED: FxItem['type'][] = ['lunge', 'impact', 'dodge', 'blocked'];

function BattleStage({
  team,
  opponentSets,
  beats,
  sceneIndex,
  battleKey,
  streamDone,
  onSwapOut,
  speedOverride,
  onDone,
}: {
  team: PokemonSet[];
  opponentSets: PokemonSet[];
  beats: ReturnType<typeof toBeats>;
  /** Picks the background scene (battle index — varies rung to rung). */
  sceneIndex: number;
  /** Rung identity: playback restarts only when this changes, never on the
   * (growing) beats array. */
  battleKey: number;
  /** True once the full result landed — the beats array is final. */
  streamDone: boolean;
  /** Dev/e2e ?speed= override, applied once on mount. */
  speedOverride?: number;
  onDone: () => void;
  /** Start the dip out, timed to finish as the run advances. */
  onSwapOut: (fadeMs?: number) => void;
}) {
  const teams = useMemo(() => [team, opponentSets] as [PokemonSet[], PokemonSet[]], [team, opponentSets]);
  const playback = usePlayback(teams, beats, onDone, {streamDone, battleKey, speedOverride});
  const {view, fx, fxKey, caption, beatMs, speed, setSpeed} = playback;

  const active = (side: 0 | 1): MonView | undefined => {
    const s = view.sides[side];
    return s.activeIndex !== undefined ? s.mons[s.activeIndex] : undefined;
  };
  const mine = active(0);
  const theirs = active(1);

  // Send-out pop-in, per side: each side's own mon (and its pokeball) animates
  // in via a CSS class present only for a short window right after that side's
  // sprite first appears — anchored to the mon's own arrival, not to a shared
  // mount-relative timer, so it can never expire before a late-landing second
  // lead gets its entrance (see usePlayback's turn-0 pacing, which now lands
  // both leads close together, but this stays correct even if that drifts).
  // Kept out of the replay's beat/fx pipeline on purpose — the turn-0 lead
  // placement must stay fx-free there so the visual baseline's at-rest frame
  // is unchanged (see replay/view.ts).
  const [mineJustIn, setMineJustIn] = useState(false);
  const [theirsJustIn, setTheirsJustIn] = useState(false);
  useEffect(() => {
    if (!mine) return;
    setMineJustIn(true);
    const timer = setTimeout(() => setMineJustIn(false), 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `mine` is a new
    // object every beat (immutable-clone pattern); only its presence matters.
  }, [!!mine]);
  useEffect(() => {
    if (!theirs) return;
    setTheirsJustIn(true);
    const timer = setTimeout(() => setTheirsJustIn(false), 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!theirs]);

  const fxFor = (side: 0 | 1, type: FxItem['type']) => fx.find(f => f.side === side && f.type === type);
  /** Every damage number this beat put on a side. A multi-hit move produces one
   * per hit, and taking only the first threw the rest away: Bullet Seed landing
   * four times looked exactly like it landing once. */
  const floatsFor = (side: 0 | 1) => fx.filter(f => f.side === side && f.type === 'float');
  /** How long this side's bar should take to drain this beat: proportional to
   * the size of the change, so a chip and a near-KO no longer look identical.
   * Multi-hit moves land several floats but the bar only moves once, so the
   * magnitudes add up. Undefined when nothing changed, which leaves the CSS
   * default in place. */
  const drainFor = (side: 0 | 1): number | undefined => {
    const total = floatsFor(side).reduce((sum, f) => sum + Math.abs(f.delta ?? 0), 0);
    return total > 0 ? drainMs(total, speed) : undefined;
  };
  const outgoingFor = (side: 0 | 1) => fxFor(side, 'switch')?.outgoingSpecies;
  /** The departing mon's own view row, so its HP box can leave with it instead
   * of the box snapping to the arriving mon's name while the old sprite is
   * still recalling. `applyBeat` only rewrites the INCOMING mon's hp, so this
   * row still holds the values it had on the field. */
  const outgoingMon = (side: 0 | 1): MonView | undefined => {
    const species = outgoingFor(side);
    return species ? view.sides[side].mons.find(m => m.species === species) : undefined;
  };

  // Category + move-type flavor for a side's FX this beat: the category picks
  // the animation style (contact spark / beam / self-glow), the type colors it
  // via --fx-color. Falls back to the untyped default when absent. `signature`
  // layers a fully bespoke override on top for a small curated set of
  // high-frequency moves (see SIGNATURE_MOVES in sixoh/fx.ts).
  const fxFlavor = (side: 0 | 1) => {
    const item = fx.find(f => f.side === side && FLAVORED.includes(f.type));
    return {
      category: item?.category ? `fx-${item.category.toLowerCase()}` : undefined,
      color: item?.moveType ? typeColor(item.moveType) : undefined,
      moveType: item?.moveType?.toLowerCase(),
      signature: signatureSlug(item?.move),
    };
  };
  const holderClasses = (side: 0 | 1, lungeClass: string, status?: string) => {
    const flavor = fxFlavor(side);
    return [
      'sprite-holder',
      side === 1 ? 'theirs' : 'mine',
      // Drives the persistent on-field condition effect (embers, bubbles...).
      status && `st-${status}`,
      fxFor(side, 'lunge') && lungeClass,
      fxFor(side, 'impact') && 'impact',
      fxFor(side, 'impact')?.crit && 'fx-crit',
      fxFor(side, 'dodge') && 'dodge',
      fxFor(side, 'blocked') && 'blocked',
      fxFor(side, 'impact')?.effectiveness && `fx-${fxFor(side, 'impact')!.effectiveness}`,
      fxFor(side, 'faint') && 'faint-drop',
      fxFor(side, 'tera') && 'tera-flash',
      fxFor(side, 'switch') && 'switch-pop',
      (side === 0 ? mineJustIn : theirsJustIn) && 'lead-in',
      flavor.category,
      flavor.moveType && `fx-move-${flavor.moveType}`,
      flavor.signature && `fx-signature-${flavor.signature}`,
    ]
      .filter(Boolean)
      .join(' ');
  };
  /** A ball accompanies every entrance: the send-out window and mid-battle
   * switch-ins alike. */
  const showBall = (side: 0 | 1) =>
    ((side === 0 ? mineJustIn : theirsJustIn) || !!fxFor(side, 'switch')) && !fxFor(side, 'faint');
  /**
   * How long the arriving Pokemon waits before it pops in.
   *
   * A switch speaks twice — "Dragapult, come back!" then "Go! Fezandipiti!" —
   * and the arrival belongs to the second page. Without this the recall beam,
   * the ball toss and the new sprite all fired at the top of the beat, so the
   * field showed the incoming mon while the box was still saying goodbye to
   * the outgoing one.
   *
   * Multiplied back up by `fxRate` because useFxRestart sets `playbackRate` on
   * the restarted animations, which compresses delay and duration together —
   * without the pre-compensation the wait would be divided by the speed twice.
   */
  const switchDelay = (side: 0 | 1): string | undefined =>
    outgoingFor(side) ? `${((beatMs / 2) * fxRate) / 1000}s` : undefined;
  const holderStyle = (side: 0 | 1): CSSProperties | undefined => {
    const style: Record<string, string> = {};
    const color = fxFlavor(side).color;
    if (color) style['--fx-color'] = color;
    const delay = switchDelay(side);
    if (delay) style['--fx-switch-delay'] = delay;
    return Object.keys(style).length ? (style as CSSProperties) : undefined;
  };
  /** Later hits of a multi-hit move stagger in time and stack upward, so four
   * numbers read as four hits instead of one illegible pile. The first is left
   * untouched, so the overwhelmingly common single-hit case renders exactly as
   * it did before. */
  const floatStyle = (i: number): CSSProperties | undefined =>
    i === 0
      ? undefined
      : ({
          animationDelay: `calc(var(--fx-hit-delay, 0s) + ${(i * 0.14).toFixed(2)}s)`,
          '--fx-float-index': String(i),
          // Stacking alone is not enough: floatUp travels 26px, further than
          // the 15px step, so consecutive numbers would cross and overlap.
          // Fanning them alternately left and right keeps every hit readable.
          '--fx-float-dx': `${(i % 2 ? 1 : -1) * 32 * Math.ceil(i / 2)}px`,
        } as CSSProperties);
  /** How long this side's HP drain should wait, so it reads as caused by the
   * hit rather than by the beat. Only when the side is actually being hit. */
  const hitDelay = (side: 0 | 1): string | undefined => {
    if (!fxFor(side, 'impact')) return undefined;
    const category = fxFlavor(side).category;
    if (category === 'fx-special') return HIT_DELAY.special;
    if (category === 'fx-physical') return HIT_DELAY.physical;
    return undefined;
  };

  // Background flavor: a per-rung scene, tinted by live weather/terrain.
  // Class names are normalized protocol strings ("RainDance" -> wx-raindance,
  // "Electric Terrain" -> terrain-electric).
  // Which side the camera leans toward this beat, if any. `??` and not `||`,
  // since side 0 is falsy. A faint outranks a crit, though in practice they
  // never share a beat: `toBeats` groups a move with its own damage and notes
  // only, so a faint always gets its own. A critical KO therefore plays the
  // push twice in a row from the same token, which works because `push-*` is
  // in FIELD_CLASSES and gets restarted.
  const pushSide =
    fx.find(f => f.type === 'faint')?.side ?? fx.find(f => f.type === 'impact' && f.crit)?.side;
  // A crit push should land WITH the hit, not ahead of it. `--fx-hit-delay`
  // lives on the sprite holder and custom properties do not inherit upward,
  // so the field gets told separately. A faint is its own beat, so no wait.
  const cameraDelay = fx.some(f => f.type === 'faint') ? undefined : hitDelay(pushSide ?? 1);

  // The whole-field reaction to a hit: a type-coloured wash centred on whoever
  // got hit, plus a jolt for contact moves. Gen 5 answers every attack at
  // screen scale; without this the field itself only ever moved on a KO or a
  // crit, and everything else was an 80px decal inside a sprite box.
  const struck = fx.find(f => f.type === 'impact');
  const strikeSide = struck?.side;
  const strikeDelay = strikeSide === undefined ? undefined : hitDelay(strikeSide);
  // Contact moves only, and never alongside a camera push or a KO shake: those
  // are the bigger emphasis and both would fight this for the field's single
  // `animation` channel.
  const jolt =
    struck !== undefined &&
    fxFlavor(strikeSide as 0 | 1).category === 'fx-physical' &&
    pushSide === undefined &&
    !fx.some(f => f.type === 'faint');
  const strikeStyle: CSSProperties = {};
  if (cameraDelay) (strikeStyle as Record<string, string>)['--fx-camera-delay'] = cameraDelay;
  if (strikeDelay) (strikeStyle as Record<string, string>)['--fx-strike-delay'] = strikeDelay;
  if (strikeSide !== undefined) {
    // Centre the wash on the mon that was hit, using the same geometry
    // variables the field defines for the sprite positions.
    (strikeStyle as Record<string, string>)['--fx-strike-x'] =
      strikeSide === 0 ? 'var(--mon-mine-x)' : 'var(--mon-theirs-x)';
    (strikeStyle as Record<string, string>)['--fx-strike-y'] =
      strikeSide === 0 ? 'var(--mon-mine-y)' : 'var(--mon-theirs-y)';
    const color = fxFlavor(strikeSide).color;
    if (color) (strikeStyle as Record<string, string>)['--fx-strike-color'] = color;
  }

  // Start the dip out so it finishes exactly as the run advances. Gated on the
  // stream being finished: playback can park ON the win beat while the search
  // is still landing, and fading there would hold a dark stage for as long as
  // that takes.
  const hasWinner = view.winner !== undefined;
  useEffect(() => {
    if (!hasWinner || !streamDone) return;
    const winBeatMs = PACE.win / Math.max(speed, 0.1);
    // The dip's duration travels with it: at speed the beat is shorter than
    // the full fade, and a CSS transition still running when the rung
    // advances springs back from partial opacity instead of passing through.
    const timer = setTimeout(() => onSwapOut(swapFadeMs(winBeatMs)), swapOutDelayMs(winBeatMs));
    return () => clearTimeout(timer);
  }, [hasWinner, streamDone, speed, onSwapOut]);

  const terrain = view.fields.find(f => f.endsWith('Terrain'));
  // Weather and terrain each get their own layer element. They used to share
  // `.stage-field::after` at equal specificity, so with both up the terrain
  // rule won on source order and the weather simply disappeared.
  const wxClass = view.weather ? `wx-${view.weather.toLowerCase().replace(/[^a-z]/g, '')}` : undefined;
  const terrainClass = terrain
    ? `terrain-${terrain.toLowerCase().replace(/ ?terrain/, '').replace(/[^a-z]/g, '')}`
    : undefined;
  const fieldClasses = [
    'stage-field',
    wxClass,
    terrainClass,
    fx.some(f => f.type === 'faint') && 'stage-shake',
    fx.some(f => f.type === 'impact' && f.crit) && 'crit-flash',
    pushSide !== undefined && (pushSide === 0 ? 'push-mine' : 'push-theirs'),
    fx.some(f => f.type === 'impact' && f.move === 'Earthquake') && 'earthquake-shake',
    fx.some(f => f.type === 'lunge' && f.move === 'Stealth Rock') && 'stealth-rock-fall',
    fx.some(f => f.type === 'lunge' && f.move === 'Spikes') && 'spikes-fall',
    fx.some(f => f.type === 'lunge' && f.move === 'Defog') && 'defog-sweep',
    fx.some(f => f.type === 'lunge' && f.move === 'Toxic Spikes') && 'toxic-spikes-fall',
    fx.some(f => f.type === 'lunge' && f.move === 'Sticky Web') && 'sticky-web-spread',
    fx.some(f => f.type === 'lunge' && f.move === 'Chilly Reception') && 'chilly-reception-snow',
    fx.some(f => f.type === 'lunge' && f.move === 'Court Change') && 'court-change-swap',
    fx.some(f => f.type === 'lunge' && f.move === 'Haze') && 'haze-veil',
    fx.some(f => f.type === 'lunge' && f.move === 'Snowscape') && 'snowscape-settle',
    jolt && 'strike-jolt',
  ]
    .filter(Boolean)
    .join(' ');

  // The message box speaks the current beat; once the replay is idle (or was
  // skipped) it holds the last thing said so it never sits empty mid-battle.
  const spoken = caption.length ? caption : view.logLines.slice(-1);

  const sceneNum = ((sceneIndex % 4) + 4) % 4;
  const scene = BATTLE_SCENES[sceneNum];

  // The holders persist across beats now (keyed on species, so only a real
  // switch rebuilds them); these restart the FX in place instead. Animations
  // are also compressed at high speed so an effect keeps occupying the same
  // fraction of a beat rather than being cut off by the next one.
  const fxRate = Math.max(1, speed);
  const theirsRef = useFxRestart<HTMLDivElement>(fxKey, fxRate);
  const mineRef = useFxRestart<HTMLDivElement>(fxKey, fxRate);
  const fieldRef = useFxRestart<HTMLDivElement>(fxKey, fxRate, FIELD_CLASSES);
  // The field is fluid, so the distance the FX have to travel is only knowable
  // by measuring it. Re-measured whenever the mons change.
  useStageGeometry(fieldRef, `${theirs?.species ?? ''}|${mine?.species ?? ''}`);

  return (
    <>
      <div className="battle-frame">
        <div className="battle-stage">
          <div
            ref={fieldRef}
            className={fieldClasses}
            style={strikeStyle}
          >
            <HazardCorner side={1} hazards={view.sides[1].hazards} />
            <HazardCorner side={0} hazards={view.sides[0].hazards} />

            {/* Everything a camera may move lives in here; the HP boxes and
                hazard glyphs stay outside it, since chrome should hold still
                while the world leans. */}
            <div className="stage-world" style={{backgroundImage: `url(${sceneUrl(scene.file)})`}}>
            <span className="stage-base theirs" />
            <span className="stage-base mine" />

            {outgoingFor(1) && (
              <div key={`t-out-${outgoingFor(1)}`} className="sprite-holder theirs switch-out">
                <SpriteWithFallback species={outgoingFor(1)!} back={false} />
              </div>
            )}
            {/* Kept mounted for the beat that knocks it out: `applyBeat` sets
                `fainted` in the same beat that emits the faint FX, so gating on
                `!fainted` alone unmounts the holder on the exact frame
                `.faint-drop` would start and the KO becomes an instant vanish.
                Self-guarding on the skip path: `foldBeats` leaves no FX, so a
                fainted mon still renders nothing. */}
            {theirs && (!theirs.fainted || fxFor(1, 'faint')) && (
              <div
                key={`t-${theirs.species}`}
                ref={theirsRef}
                className={holderClasses(1, 'lunge-left', theirs.status)}
                style={holderStyle(1)}
              >
                <SpriteWithFallback species={theirs.species} back={false} />
                {showBall(1) && <span className="switch-ball" aria-hidden="true" />}
                {fxFor(1, 'impact')?.effectiveness === 'super' && (
                  <span key={`e-${fxKey}`} className="fx-eff" aria-hidden="true" />
                )}
                {floatsFor(1).map((f, i) => (
                  <span key={`${fxKey}-${i}`} className="float-num" style={floatStyle(i)}>
                    {f.text}
                  </span>
                ))}
              </div>
            )}
            {outgoingFor(0) && (
              <div key={`m-out-${outgoingFor(0)}`} className="sprite-holder mine switch-out">
                <SpriteWithFallback species={outgoingFor(0)!} back={true} />
              </div>
            )}
            {mine && (!mine.fainted || fxFor(0, 'faint')) && (
              <div
                key={`m-${mine.species}`}
                ref={mineRef}
                className={holderClasses(0, 'lunge-right', mine.status)}
                style={holderStyle(0)}
              >
                <SpriteWithFallback species={mine.species} back={true} />
                {showBall(0) && <span className="switch-ball" aria-hidden="true" />}
                {fxFor(0, 'impact')?.effectiveness === 'super' && (
                  <span key={`e-${fxKey}`} className="fx-eff" aria-hidden="true" />
                )}
                {floatsFor(0).map((f, i) => (
                  <span key={`${fxKey}-${i}`} className="float-num" style={floatStyle(i)}>
                    {f.text}
                  </span>
                ))}
              </div>
            )}

            {/* After the sprite holders on purpose: both sit at z-index 1, so
                DOM order is what puts the wash over the Pokemon, exactly where
                the old ::after painted it. Absent when there is no weather, so
                a plain battle renders the same DOM it always did. */}
            {wxClass && <span className={`wx-layer ${wxClass}`} aria-hidden="true" />}
            {terrainClass && <span className={`terrain-layer ${terrainClass}`} aria-hidden="true" />}

            {/* The battle is decided: vignette down to whoever is left
                standing. `winner` is 0 for us, 1 for them and null for a tie,
                so this has to spotlight THEIR side on a loss. Deriving it from
                "our side" would glow your own fainted mon. */}
            {view.winner !== undefined && (
              <span
                className={`win-glow ${view.winner === 0 ? 'win-mine' : view.winner === 1 ? 'win-theirs' : 'win-tie'}`}
                aria-hidden="true"
              />
            )}
            </div>

            {/* Keyed on the beat so it remounts and replays each hit. Outside
                `.stage-world` on purpose: the wash is the screen reacting, so
                it should not lean with the camera. */}
            {strikeSide !== undefined && (
              <span key={`strike-${fxKey}`} className="strike-layer" aria-hidden="true" />
            )}

            {/* The departing box, sliding off with its Pokemon. Keyed on the
                species so a second switch rebuilds it rather than reusing the
                previous one mid-animation. */}
            {outgoingMon(1) && (
              <HpBar key={`t-hp-out-${outgoingFor(1)}`} mon={outgoingMon(1)!} side="theirs" motion="out" />
            )}
            {theirs && (
              <HpBar
                key={`t-hp-${theirs.species}`}
                mon={theirs}
                side="theirs"
                hitDelay={hitDelay(1)}
                drain={drainFor(1)}
                motion={fxFor(1, 'switch') ? 'in' : undefined}
                switchDelay={switchDelay(1)}
              />
            )}
            {outgoingMon(0) && (
              <HpBar key={`m-hp-out-${outgoingFor(0)}`} mon={outgoingMon(0)!} side="mine" motion="out" />
            )}
            {mine && (
              <HpBar
                key={`m-hp-${mine.species}`}
                mon={mine}
                side="mine"
                hitDelay={hitDelay(0)}
                drain={drainFor(0)}
                motion={fxFor(0, 'switch') ? 'in' : undefined}
                switchDelay={switchDelay(0)}
              />
            )}
          </div>

          <MessageBox lines={spoken} beatKey={fxKey} beatMs={beatMs} speed={speed} />
        </div>
      </div>

      <div className="battle-below">
        <FieldStrip weather={view.weather} fields={view.fields} sides={view.sides} />

        <div className="stage-meta">
          <TeamRow side={view.sides[0]} mons={team} />
          <span className="mono turn-label">Turn {view.turn}</span>
          <TeamRow side={view.sides[1]} mons={opponentSets} />
        </div>

        <div className="battle-log mono" ref={el => el?.scrollTo(0, el.scrollHeight)}>
          {view.logLines.slice(-80).map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>

        <div className="playback-controls">
          <span className="playback-label">SPEED</span>
          <div className="playback-speed">
            {/* Position-based (0..1) with a log mapping, so the 0.5x-3x band
                most users live in owns the middle of the track. */}
            <input
              type="range"
              min={0}
              max={1}
              step={0.005}
              value={speedToPosition(speed)}
              aria-label="Playback speed"
              onChange={event => setSpeed(positionToSpeed(Number(event.target.value)))}
              style={{'--_fill': `${speedToPosition(speed) * 100}%`} as CSSProperties}
            />
            <div className="playback-ticks">
              {[0.1, 0.5, 1, 2, 3, 5].map(tick => (
                <span key={tick} style={{left: `${speedToPosition(tick) * 100}%`}}>
                  {tick}×
                </span>
              ))}
            </div>
          </div>
          <span className="playback-value mono">{speed.toFixed(1)}×</span>
        </div>
      </div>
    </>
  );
}

export function SixOhGauntlet() {
  const state = useSixOhState();
  const dispatch = useSixOhDispatch();
  const dev = useMemo(() => readDevParams(), []);
  const [elapsed, setElapsed] = useState(0);

  const index = state.battleIndex;
  const battle = state.battles[index];

  // Reduced-motion users skip the intro entirely (this is exactly the FX
  // class the app already suppresses) and get the plain simulating panel,
  // which also keeps the visual-regression flow (reducedMotion: 'reduce')
  // byte-identical to the pre-intro one.
  const reducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    []
  );
  const [introDoneFor, setIntroDoneFor] = useState(-1);
  const introDone = reducedMotion || introDoneFor === index;
  // Gated in JS, not CSS. The dip is a `transition`, so `animation: none`
  // would not touch it and `transition: none` would snap straight to opacity
  // 0: a blank flash, strictly worse than the hard cut it replaces. Same
  // reasoning that already skips the intro for these users.
  const {swapClass, beginSwapOut, swapStyle} = useStageSwap(index, !reducedMotion);
  const handleIntroDone = useCallback(() => setIntroDoneFor(index), [index]);

  useEffect(() => {
    ensureComputed(state, dispatch, dev);
  }, [state, dispatch, dev]);

  // Elapsed timer for the "simulating" state.
  useEffect(() => {
    if (battle?.phase !== 'computing' && battle?.phase !== 'pending') return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, [battle?.phase, index]);

  // Auto-advance to the result only on the *live* finish transition. If the
  // screen is re-entered already-finished (browser Back from the result), don't
  // redirect — that would trap the user in a result↔gauntlet loop; show a
  // terminal panel instead (below).
  const wasFinishedOnMount = useRef(state.phase === 'finished');
  // A live run is memory-only: reloading lands on "No run in progress".
  useUnloadGuard(state.phase !== 'draft' && state.phase !== 'finished');
  useEffect(() => {
    if (state.phase === 'finished' && !wasFinishedOnMount.current) navigate('sixoh-result');
  }, [state.phase]);

  const draftAgain = () => {
    resetSixOhSession();
    dispatch({type: 'RESET'});
    navigate('sixoh-draft');
  };
  const retry = () => {
    // Retry the rung that actually failed - a prefetched next rung can error
    // while the on-screen one is still fine, so this isn't always `index`.
    retryBattle(state.errorIndex ?? index);
    dispatch({type: 'CLEAR_ERROR'});
  };

  // Beats over the streamed partial log while the search runs, switching to
  // the authoritative result log when it lands (same lines by construction,
  // so the swap is invisible; usePlayback keys restarts on the rung, not
  // this array's identity). Re-parsing the whole accumulated log per chunk
  // is a single pass over <=4k lines (~1-2ms) once per decision.
  const log = battle?.result?.protocolLog ?? battle?.partialLog;
  // The trainer's full title, so the textbox can say "Gym Leader Maylene sent
  // out Hariyama!" the way the games do. Same string the intro announces with.
  const foeTitle = state.opponents[index]
    ? foeSpokenName(state.opponents[index], state.mode)
    : undefined;
  const beats = useMemo(() => {
    if (!log?.length) return undefined;
    try {
      return toBeats(
        parseProtocol(log, ['Your', 'The opposing'], {dialogue: true, trainer: foeTitle})
      );
    } catch (error) {
      // This runs on the render path once per streamed decision, so a parse
      // throw here white-screens a live battle via the ErrorBoundary. The
      // parser is guarded against every malformed line we know of; this is
      // the backstop for the ones we don't (e.g. a @pkmn/sim bump changing a
      // line's shape). Losing the animation beats degrades to the static
      // result card, which is a far better outcome than losing the screen.
      console.error('replay parse failed; falling back to a static result', error);
      return undefined;
    }
  }, [log, foeTitle]);  const hasBeats = !!beats?.length;

  useEffect(() => {
    if (battle?.phase === 'ready') dispatch({type: 'REPLAY_STARTED', index});
  }, [battle?.phase, dispatch, index]);

  // Memoized so BattleStage's usePlayback sees a STABLE onDone across
  // renders this screen makes for unrelated reasons (most commonly a
  // background rung-prefetch resolving while this battle is still
  // replaying) — an inline `() => dispatch(...)` here is a new function
  // reference every such render, which cascades through usePlayback's
  // finish/step useCallbacks and retriggers its progress-reset effect,
  // silently snapping the in-progress battle back to turn 0.
  const handleReplayFinished = useCallback(() => {
    dispatch({type: 'REPLAY_FINISHED', index});
  }, [dispatch, index]);

  if (!state.team || state.phase === 'draft') {
    return (
      <main className="screen">
        <div className="empty-state">
          No run in progress, <a href="#/sixoh">draft a team</a> to start the gauntlet.
        </div>
      </main>
    );
  }

  // Re-entered a finished run (Back from the result): terminal choice, no loop.
  if (state.phase === 'finished' && wasFinishedOnMount.current) {
    return (
      <main className="screen">
        <div className="empty-state">
          <p>This run is over ({state.record.wins}–{state.record.losses}).</p>
          <div className="result-actions">
            <button className="primary" onClick={() => navigate('sixoh-result')}>
              See the result
            </button>
            <button onClick={draftAgain}>Draft again</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="arena">
      <aside className="gauntlet-rail">
        <div className="mono record">
          {state.record.wins}–{state.record.losses}
        </div>
        <ol className="ladder">
          {state.opponents.map((opponent, i) => {
            const b = state.battles[i];
            const mark =
              b.phase === 'done' ? (b.result?.winner === 0 ? 'W' : 'L') : i === index ? '•' : '';
            return (
              <li key={i} className={`ladder-rung ${i === index ? 'current' : ''} ${b.phase === 'done' ? 'played' : ''}`}>
                <span className="rung-number mono">{i + 1}</span>
                {opponent.avatarKey && <TrainerPortrait avatarKey={opponent.avatarKey} className="rung-portrait" />}
                <span className="rung-name">{opponent.name}</span>
                <span className="mono rung-mark">{mark}</span>
              </li>
            );
          })}
        </ol>
        {(dev.tera !== undefined || dev.configName === 'fast') && (
          <p className="hint mono">
            dev: {dev.configName === 'fast' ? 'config=fast ' : ''}
            {dev.tera !== undefined ? `TERA_AVAILABLE=${dev.tera}` : ''}
          </p>
        )}
      </aside>

      <section className="gauntlet-main">
        <h1 className="battle-title">
          {state.opponents[index]?.avatarKey && (
            <TrainerPortrait avatarKey={state.opponents[index].avatarKey!} className="title-portrait" />
          )}
          Battle {index + 1} of {state.opponents.length} vs {state.opponents[index]?.name}
        </h1>

        {/* A prefetched next rung can error while this on-screen rung is
            still fine (still computing, or replaying a win) - only treat the
            error as blocking THIS rung's display when it's actually the one
            that failed; otherwise it surfaces once the run reaches it. */}
        {/* One node that survives the rung change, so the dip has somewhere to
            happen while React swaps two entirely different subtrees beneath
            it. Wraps all three branches, not just the frame: the stage also
            renders the log, meta row and controls, and wrapping only the
            frame would leave those popping out at full opacity. */}
        <div className={swapClass} style={swapStyle}>
        {(!state.error || state.errorIndex !== index) &&
          !introDone &&
          battle &&
          battle.phase !== 'done' && (
            <BattleIntro
              key={index}
              opponent={state.opponents[index]}
              mode={state.mode}
              sceneIndex={index}
              ready={hasBeats}
              speed={dev.speed ?? loadSpeed()}
              onDone={handleIntroDone}
            />
          )}

        {/* Plain simulating panel: reduced-motion users (no intro) in the
            sliver before the stream's first chunk arrives. */}
        {(!state.error || state.errorIndex !== index) &&
          introDone &&
          !hasBeats &&
          (battle?.phase === 'pending' || battle?.phase === 'computing') && (
            <div className="simulating">
              <div className="pulse" />
              <p>
                Simulating battle {index + 1}… <span className="mono">{elapsed}s</span>
              </p>
              <p className="hint">Both AIs are searching every turn. This is the real thing.</p>
            </div>
          )}

        {/* The stage mounts DURING `computing` now — the battle replays while
            the search still streams the rest of it. */}
        {(!state.error || state.errorIndex !== index) &&
          introDone &&
          hasBeats &&
          (battle?.phase === 'computing' || battle?.phase === 'ready' || battle?.phase === 'replaying') &&
          beats && (
            <BattleStage
              team={state.team}
              opponentSets={state.opponents[index].sets}
              beats={beats}
              sceneIndex={index}
              battleKey={index}
              streamDone={!!battle?.result}
              speedOverride={dev.speed}
              onDone={handleReplayFinished}
              onSwapOut={beginSwapOut}
            />
          )}

        </div>

        {state.error && state.errorIndex === index && (
          <div className="empty-state">
            <p className="problems">Battle {index + 1} failed: {state.error}</p>
            <div className="result-actions">
              <button className="primary" onClick={retry}>
                Retry this battle
              </button>
              <button onClick={draftAgain}>Draft again</button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
