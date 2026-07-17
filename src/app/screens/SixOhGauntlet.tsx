import {useEffect, useMemo, useRef, useState} from 'react';
import {Icons, Sprites} from '@pkmn/img';
import type {PokemonSet} from '../../data/types';
import {parseProtocol} from '../../replay/parse';
import {toBeats} from '../../replay/pace';
import type {FxItem, MonView, SideView} from '../../replay/view';
import {navigate} from '../router';
import {readDevParams} from '../sixoh/devParams';
import {ensureComputed, resetSixOhSession, retryBattle} from '../sixoh/session';
import {useSixOhDispatch, useSixOhState} from '../sixoh/state';
import {typeColor} from '../sixoh/typeColors';
import {usePlayback, type PlaybackSpeed} from '../sixoh/usePlayback';

function SpriteWithFallback({species, back}: {species: string; back: boolean}) {
  const [broken, setBroken] = useState(false);
  const sprite = Sprites.getPokemon(species, back ? {gen: 'ani', side: 'p1'} : {gen: 'ani'});
  if (broken) {
    return <span className="sprite-fallback" style={Icons.getPokemon(species).css} title={species} />;
  }
  return (
    <img
      className="stage-sprite"
      src={sprite.url}
      alt={species}
      onError={() => setBroken(true)}
    />
  );
}

/** Classic handheld HP colour: green > 50%, yellow > 20%, red below. */
function hpColor(frac: number): string {
  if (frac > 0.5) return '#48c451';
  if (frac > 0.2) return '#f6c343';
  return '#e83c2e';
}

function HpBar({mon}: {mon: MonView}) {
  const frac = mon.maxhp > 0 ? mon.hp / mon.maxhp : 0;
  return (
    <div className="hp-block">
      <div className="hp-head">
        <span className="hp-name">{mon.species}</span>
        <span className="mono hp-level">Lv100</span>
        {mon.teraType && <span className="tera-badge" style={{background: typeColor(mon.teraType)}}>Tera {mon.teraType}</span>}
        {mon.status && <span className="status-chip">{mon.status.toUpperCase()}</span>}
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
      <span className="mono hp-label">{Math.round(frac * 100)}%</span>
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

function BattleStage({
  team,
  opponentSets,
  beats,
  onDone,
}: {
  team: PokemonSet[];
  opponentSets: PokemonSet[];
  beats: ReturnType<typeof toBeats>;
  onDone: () => void;
}) {
  const teams = useMemo(() => [team, opponentSets] as [PokemonSet[], PokemonSet[]], [team, opponentSets]);
  const playback = usePlayback(teams, beats, onDone);
  const {view, fx, fxKey, speed, setSpeed, skipToEnd} = playback;

  const active = (side: 0 | 1): MonView | undefined => {
    const s = view.sides[side];
    return s.activeIndex !== undefined ? s.mons[s.activeIndex] : undefined;
  };
  const mine = active(0);
  const theirs = active(1);
  const fxFor = (side: 0 | 1, type: FxItem['type']) => fx.find(f => f.side === side && f.type === type);

  return (
    <div className="battle-stage">
      <div className="stage-field">
        <div className="stage-half theirs">
          {theirs && !theirs.fainted && (
            <div
              key={`t-${fxKey}`}
              className={[
                'sprite-holder',
                fxFor(1, 'lunge') && 'lunge-left',
                fxFor(1, 'impact') && 'impact',
                fxFor(1, 'faint') && 'faint-drop',
                fxFor(1, 'tera') && 'tera-flash',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <SpriteWithFallback species={theirs.species} back={false} />
              {fxFor(1, 'float') && <span className="float-num">{fxFor(1, 'float')!.text}</span>}
            </div>
          )}
          {theirs && <HpBar mon={theirs} />}
        </div>
        <div className="stage-half mine">
          {mine && !mine.fainted && (
            <div
              key={`m-${fxKey}`}
              className={[
                'sprite-holder',
                fxFor(0, 'lunge') && 'lunge-right',
                fxFor(0, 'impact') && 'impact',
                fxFor(0, 'faint') && 'faint-drop',
                fxFor(0, 'tera') && 'tera-flash',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <SpriteWithFallback species={mine.species} back={true} />
              {fxFor(0, 'float') && <span className="float-num">{fxFor(0, 'float')!.text}</span>}
            </div>
          )}
          {mine && <HpBar mon={mine} />}
        </div>
      </div>

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
        {([1, 2, 'instant'] as PlaybackSpeed[]).map(s => (
          <button key={String(s)} className={speed === s ? 'active' : ''} onClick={() => setSpeed(s)}>
            {s === 'instant' ? 'Instant' : `${s}×`}
          </button>
        ))}
        <button onClick={skipToEnd}>Skip to result</button>
      </div>
    </div>
  );
}

export function SixOhGauntlet() {
  const state = useSixOhState();
  const dispatch = useSixOhDispatch();
  const dev = useMemo(() => readDevParams(), []);
  const [elapsed, setElapsed] = useState(0);

  const index = state.battleIndex;
  const battle = state.battles[index];

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
    retryBattle(index);
    dispatch({type: 'CLEAR_ERROR'});
  };

  const beats = useMemo(() => {
    if (!battle?.result?.protocolLog) return undefined;
    return toBeats(parseProtocol(battle.result.protocolLog, ['You', 'Them']));
  }, [battle?.result]);

  useEffect(() => {
    if (battle?.phase === 'ready') dispatch({type: 'REPLAY_STARTED', index});
  }, [battle?.phase, dispatch, index]);

  if (!state.team || state.phase === 'draft') {
    return (
      <main className="screen">
        <div className="empty-state">
          No run in progress — <a href="#/sixoh">draft a team</a> to start the gauntlet.
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
        <ol className="ladder dark">
          {state.opponents.map((opponent, i) => {
            const b = state.battles[i];
            const mark =
              b.phase === 'done' ? (b.result?.winner === 0 ? 'W' : 'L') : i === index ? '•' : '';
            return (
              <li key={i} className={`ladder-rung ${i === index ? 'current' : ''} ${b.phase === 'done' ? 'played' : ''}`}>
                <span className="rung-number mono">{i + 1}</span>
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
          Battle {index + 1} of {state.opponents.length} — vs {state.opponents[index]?.name}
        </h2>

        {!state.error && (battle?.phase === 'pending' || battle?.phase === 'computing') && (
          <div className="simulating">
            <div className="pulse" />
            <p>
              Simulating battle {index + 1}… <span className="mono">{elapsed}s</span>
            </p>
            <p className="hint">Both AIs are searching every turn. This is the real thing.</p>
          </div>
        )}

        {!state.error && (battle?.phase === 'ready' || battle?.phase === 'replaying') && beats && (
          <BattleStage
            team={state.team}
            opponentSets={state.opponents[index].sets}
            beats={beats}
            onDone={() => dispatch({type: 'REPLAY_FINISHED', index})}
          />
        )}

        {state.error && (
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
