import {useMemo} from 'react';
import {Icons} from '@pkmn/img';
import {gen9} from '../../data/gen';
import {buildPostMortem} from '../../analysis/postmortem';
import type {PokemonSet} from '../../data/types';
import type {DraftMode} from '../../draft/draft';
import {ReadItem as Read} from '../components/ReadItem';
import {TrainerPortrait} from '../components/TrainerPortrait';
import {MODE_LABELS} from '../sixoh/modeLabels';
import {resetSixOhSession} from '../sixoh/session';
import {useSixOhDispatch, useSixOhState} from '../sixoh/state';
import {typeGradient} from '../sixoh/typeColors';

function RosterIcons({sets, className, tiled}: {sets: PokemonSet[]; className?: string; tiled?: boolean}) {
  return (
    <span className={className ?? 'roster-icons'}>
      {sets.map((set, i) =>
        tiled ? (
          <span
            key={i}
            className="mon-tile"
            style={{backgroundImage: typeGradient(gen9().species.get(set.species)?.types ?? [])}}
          >
            <span className="team-icon" style={Icons.getPokemon(set.species).css} title={set.species} />
          </span>
        ) : (
          <span key={i} className="team-icon" style={Icons.getPokemon(set.species).css} title={set.species} />
        )
      )}
    </span>
  );
}

export function SixOhResult() {
  const state = useSixOhState();
  const dispatch = useSixOhDispatch();

  const postMortem = useMemo(() => {
    if (state.phase !== 'finished' || !state.team || !state.outcome) return undefined;
    const played = state.battles
      .map((battle, i) => ({opponentIndex: i, result: battle.result!}))
      .filter(b => b.result && state.battles[b.opponentIndex].phase === 'done');
    return buildPostMortem(gen9(), state.team, state.opponents, played, state.outcome);
  }, [state]);

  if (!postMortem || !state.outcome) {
    return (
      <main className="screen">
        <div className="empty-state">
          No finished run yet, <a href="#/sixoh">draft a team</a> and run the gauntlet.
        </div>
      </main>
    );
  }

  // Restart into a chosen difficulty. The mode rides in the hash query so the
  // draft screen picks it up on mount (preserving any dev params like seed).
  const restartAs = (mode: DraftMode) => {
    resetSixOhSession();
    dispatch({type: 'RESET'});
    const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
    params.set('mode', mode);
    location.hash = `#/sixoh?${params.toString()}`;
  };

  const played = state.battles
    .map((battle, i) => ({index: i, battle}))
    .filter(({battle}) => battle.phase === 'done' && battle.result);
  // The game that ended an eliminated run: the last played loss.
  const killerIndex =
    state.outcome === 'eliminated' && played.length ? played[played.length - 1].index : undefined;

  return (
    <main className="arena result-screen">
      <div className={`result-card ${state.outcome}`}>
        <div className="mono result-record">{postMortem.record}</div>
        <h1>{postMortem.headline}</h1>
        {state.outcome === 'flawless' && <p className="flawless-sub">Every rung. No losses. Go touch grass, champion.</p>}

        {state.team && (
          <div className="team-recap">
            <span className="recap-label">Your six</span>
            <RosterIcons sets={state.team} className="roster-icons recap-roster" tiled />
          </div>
        )}

        <ol className="game-strip">
          {played.map(({index, battle}) => {
            const won = battle.result!.winner === 0;
            const opponent = state.opponents[index];
            return (
              <li
                key={index}
                className={`game-row ${won ? 'won' : 'lost'} ${index === killerIndex ? 'killer' : ''}`}
              >
                <span className="mono game-num">{index + 1}</span>
                {opponent?.avatarKey && <TrainerPortrait avatarKey={opponent.avatarKey} className="rung-portrait" />}
                <span className="game-name">{opponent?.name}</span>
                {opponent && <RosterIcons sets={opponent.sets} />}
                <span className="mono game-turns">{battle.result!.turns} turns</span>
                <span className={`mono game-mark ${won ? 'won' : 'lost'}`}>{won ? 'W' : 'L'}</span>
              </li>
            );
          })}
        </ol>
        {killerIndex !== undefined && (
          <p className="killer-note">
            Run ended by <strong>{state.opponents[killerIndex]?.name}</strong> on rung {killerIndex + 1}.
          </p>
        )}

        <section className="post-mortem">
          <h3>Post-mortem</h3>
          {postMortem.reads.length === 0 && <p className="hint">Clean sweep, nothing to autopsy.</p>}
          {postMortem.reads.map((read, i) => (
            <Read key={i} sentence={read.sentence} evidence={read.evidence} />
          ))}
        </section>

        <div className="result-actions">
          <button className="primary" onClick={() => restartAs(state.mode)}>
            Draft again
          </button>
          {state.mode === 'gymleader' && (
            <button onClick={() => restartAs('easy')}>Step up to {MODE_LABELS.easy}</button>
          )}
          {state.mode === 'easy' && (
            <button onClick={() => restartAs('hard')}>Step up to {MODE_LABELS.hard}</button>
          )}
        </div>
      </div>
    </main>
  );
}
