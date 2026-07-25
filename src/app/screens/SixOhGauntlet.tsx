import {useCallback, useEffect, useMemo, useRef, useState, type CSSProperties} from 'react';
import {Icons, Sprites} from '@pkmn/img';
import type {PokemonSet} from '../../data/types';
import {parseProtocol} from '../../replay/parse';
import {toBeats} from '../../replay/pace';
import type {FxItem, MonView, SideView} from '../../replay/view';
import {navigate} from '../router';
import {readDevParams} from '../sixoh/devParams';
import {HIT_DELAY, signatureSlug} from '../sixoh/fx';
import {BATTLE_SCENES, sceneUrl} from '../sixoh/scenes';
import {FIELD_CLASSES, useFxRestart} from '../sixoh/useFxRestart';
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

function SpriteWithFallback({species, back}: {species: string; back: boolean}) {
  const startTier: SpriteTier = knownMissingGen5Ani.has(species) ? 'gen5' : 'gen5ani';
  const [tier, setTier] = useState<SpriteTier>(startTier);
  useEffect(() => {
    setTier(knownMissingGen5Ani.has(species) ? 'gen5' : 'gen5ani');
  }, [species]);

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
      style={{animationDelay: `-${speciesPhase(species)}ms`}}
    >
      {inner}
    </span>
  );
}

/** HP meter colour: green > 50%, yellow > 20%, red below. */
function hpColor(frac: number): string {
  if (frac > 0.5) return '#48c451';
  if (frac > 0.2) return '#f6c343';
  return '#e83c2e';
}

function HpBar({mon, side, hitDelay}: {mon: MonView; side: 'theirs' | 'mine'; hitDelay?: string}) {
  const frac = mon.maxhp > 0 ? mon.hp / mon.maxhp : 0;
  // Matches hpColor's red threshold, so the pulse starts exactly when the bar
  // turns red rather than at some second, invisible cutoff.
  const critical = frac > 0 && frac <= 0.2;
  return (
    <div
      className={`hp-block ${side}${critical ? ' critical' : ''}`}
      style={hitDelay ? ({'--fx-hit-delay': hitDelay} as CSSProperties) : undefined}
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
        <span className="mono hp-numeric">{Math.max(0, mon.hp)} / {mon.maxhp}</span>
      ) : (
        <span className="mono hp-label">{Math.round(frac * 100)}%</span>
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
}) {
  const teams = useMemo(() => [team, opponentSets] as [PokemonSet[], PokemonSet[]], [team, opponentSets]);
  const playback = usePlayback(teams, beats, onDone, {streamDone, battleKey, speedOverride});
  const {view, fx, fxKey, caption, speed, setSpeed} = playback;

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
  const outgoingFor = (side: 0 | 1) => fxFor(side, 'switch')?.outgoingSpecies;

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
  const holderStyle = (side: 0 | 1): CSSProperties | undefined => {
    const color = fxFlavor(side).color;
    return color ? ({'--fx-color': color} as CSSProperties) : undefined;
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
    fx.some(f => f.type === 'impact' && f.move === 'Earthquake') && 'earthquake-shake',
    fx.some(f => f.type === 'lunge' && f.move === 'Stealth Rock') && 'stealth-rock-fall',
    fx.some(f => f.type === 'lunge' && f.move === 'Spikes') && 'spikes-fall',
    fx.some(f => f.type === 'lunge' && f.move === 'Defog') && 'defog-sweep',
    fx.some(f => f.type === 'lunge' && f.move === 'Toxic Spikes') && 'toxic-spikes-fall',
    fx.some(f => f.type === 'lunge' && f.move === 'Sticky Web') && 'sticky-web-spread',
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

  return (
    <>
      <div className="battle-frame">
        <div className="battle-stage">
          <div ref={fieldRef} className={fieldClasses}>
            <HazardCorner side={1} hazards={view.sides[1].hazards} />
            <HazardCorner side={0} hazards={view.sides[0].hazards} />

            {/* Everything a camera may move lives in here; the HP boxes and
                hazard glyphs stay outside it, since chrome should hold still
                while the world leans. */}
            <div className="stage-world" style={{backgroundImage: `url(${sceneUrl(scene.file)})`}}>
            <span className="ground-shadow theirs" />
            <span className="ground-shadow mine" />

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
            </div>

            {theirs && <HpBar mon={theirs} side="theirs" hitDelay={hitDelay(1)} />}
            {mine && <HpBar mon={mine} side="mine" hitDelay={hitDelay(0)} />}
          </div>

          <div className="message-box" role="status" aria-live="polite">
            {spoken.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
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
  const beats = useMemo(() => {
    if (!log?.length) return undefined;
    return toBeats(parseProtocol(log, ['Your', 'The opposing']));
  }, [log]);
  const hasBeats = !!beats?.length;

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
        <h2 className="battle-title">
          {state.opponents[index]?.avatarKey && (
            <TrainerPortrait avatarKey={state.opponents[index].avatarKey!} className="title-portrait" />
          )}
          Battle {index + 1} of {state.opponents.length} vs {state.opponents[index]?.name}
        </h2>

        {/* A prefetched next rung can error while this on-screen rung is
            still fine (still computing, or replaying a win) - only treat the
            error as blocking THIS rung's display when it's actually the one
            that failed; otherwise it surfaces once the run reaches it. */}
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
            />
          )}

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
