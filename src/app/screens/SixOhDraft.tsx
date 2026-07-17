import {useEffect, useMemo, useState} from 'react';
import {Icons} from '@pkmn/img';
import {DataClient} from '../../data/client';
import {loadOpponentTeams} from '../../data/sampleTeams';
import {teamMemberToSet} from '../../data/team';
import {gen9} from '../../data/gen';
import type {PoolEntry, SetsData} from '../../data/types';
import {classifyTeam} from '../../analysis/archetype';
import {
  createDraft,
  pickBundle,
  pickSet,
  pickSpecies,
  TEAM_SIZE,
  type DraftMode,
  type SetOption,
} from '../../draft/draft';
import {sampleOpponents} from '../../draft/opponents';
import {navigate} from '../router';
import {typeColor} from '../sixoh/typeColors';
import {readDevParams} from '../sixoh/devParams';
import {useSixOhDispatch, useSixOhState, type GauntletOpponent} from '../sixoh/state';
import {resetSixOhSession} from '../sixoh/session';

interface DraftData {
  pool: PoolEntry[];
  sets: SetsData;
  opponents: GauntletOpponent[];
}

function TypeBadges({species}: {species: string}) {
  const types = gen9().species.get(species)?.types ?? [];
  return (
    <span className="type-badges">
      {types.map(type => (
        <span key={type} className="type-badge" style={{background: typeColor(type)}}>
          {type}
        </span>
      ))}
    </span>
  );
}

function SetCard({option, onPick}: {option: SetOption; onPick: () => void}) {
  const {set, slashes} = option;
  const moveLine = (index: number) => {
    const slashed = slashes.moveSlots.find(s => s.slot === index);
    return slashed ? slashed.options.join(' / ') : set.moves[index];
  };
  const evs = Object.entries(set.evs)
    .filter(([, v]) => v > 0)
    .map(([stat, v]) => `${v} ${stat}`)
    .join(' / ');
  return (
    <button className="set-card" onClick={onPick}>
      <h4>{option.setName}</h4>
      <ul className="mono set-moves">
        {set.moves.map((_, i) => (
          <li key={i}>{moveLine(i)}</li>
        ))}
      </ul>
      <p className="mono set-meta">
        {set.item || 'No item'} · {set.nature} · {evs}
      </p>
      <p className="mono set-meta">
        Tera {slashes.teratypes ? slashes.teratypes.join(' / ') : set.teraType ?? '—'}
      </p>
    </button>
  );
}

export function SixOhDraft() {
  const state = useSixOhState();
  const dispatch = useSixOhDispatch();
  const [data, setData] = useState<DraftData>();
  const [error, setError] = useState<string>();
  const gen = useMemo(() => gen9(), []);
  const dev = useMemo(() => readDevParams(), []);
  // Starting difficulty from the hash (`#/sixoh?mode=hard`) so "Step up" and
  // "Draft again" can pick the mode; defaults to normal.
  const initialMode = useMemo<DraftMode>(() => {
    const raw = new URLSearchParams(location.hash.split('?')[1] ?? '').get('mode');
    return raw === 'easy' || raw === 'hard' ? raw : 'normal';
  }, []);

  // Load pool + sets + opponent teams, then deal the first hand.
  useEffect(() => {
    if (state.draft || data) return;
    const client = new DataClient('gen9ou');
    Promise.all([client.pool(), client.sets(), loadOpponentTeams(client)])
      .then(([pool, sets, teams]) => {
        const seed = dev.seed ?? Math.floor(Math.random() * 2 ** 31);
        const opponentIndices = sampleOpponents(teams.length, 6, seed ^ 0x0bb57);
        const opponents = opponentIndices.map(i => ({
          name: teams[i].name ?? `Team #${i + 1}`,
          sets: teams[i].data.map(teamMemberToSet),
        }));
        const loaded = {pool, sets, opponents};
        setData(loaded);
        resetSixOhSession();
        dispatch({
          type: 'NEW_RUN',
          seed,
          mode: initialMode,
          draft: createDraft(pool, sets, initialMode, seed ^ 0xd4af7),
          opponents,
        });
      })
      .catch(e => setError(String(e)));
  }, [state.draft, data, dispatch, dev.seed, initialMode]);

  const draft = state.draft;
  const canSwitchMode = draft && draft.team.length === 0 && draft.phase === 'species';

  const switchMode = (mode: DraftMode) => {
    if (!data || !canSwitchMode || mode === draft.mode) return;
    dispatch({type: 'SET_DRAFT', draft: createDraft(data.pool, data.sets, mode, state.runSeed ^ 0xd4af7)});
  };

  if (error) {
    return (
      <main className="screen">
        <p className="problems">
          Couldn't load the draft data: {error}. Check your connection and reload.
        </p>
      </main>
    );
  }
  if (!draft || !data) {
    return (
      <main className="screen">
        <div className="empty-state">Dealing your first hand…</div>
      </main>
    );
  }

  const startGauntlet = () => {
    dispatch({type: 'START_GAUNTLET', team: draft.team.map(pick => pick.set)});
    navigate('sixoh-gauntlet');
  };

  return (
    <main className="screen draft-screen">
      <h1>Can you 6-0?</h1>
      <p className="screen-sub">
        Draft six from randomized, usage-weighted offers. Then the AI pilots them through a
        six-battle gauntlet — win all six to go flawless.
      </p>

      <div className="mode-toggle" role="group" aria-label="Difficulty">
        <button
          className={draft.mode === 'easy' ? 'active' : ''}
          disabled={!canSwitchMode && draft.mode !== 'easy'}
          onClick={() => switchMode('easy')}
        >
          Easy <span className="hint">10 options — opponents start weak and ramp up</span>
        </button>
        <button
          className={draft.mode === 'normal' ? 'active' : ''}
          disabled={!canSwitchMode && draft.mode !== 'normal'}
          onClick={() => switchMode('normal')}
        >
          Normal <span className="hint">10 options — full-strength opponents all six</span>
        </button>
        <button
          className={draft.mode === 'hard' ? 'active' : ''}
          disabled={!canSwitchMode && draft.mode !== 'hard'}
          onClick={() => switchMode('hard')}
        >
          Hard <span className="hint">6 options — mon and set together, full strength</span>
        </button>
      </div>

      {draft.phase !== 'complete' && (
        <h2 className="round-header">
          Pick {draft.team.length + 1} of {TEAM_SIZE}
          {draft.phase === 'set' ? ` — choose ${draft.offers[0]?.species}'s set` : ''}
        </h2>
      )}

      {draft.phase === 'species' && draft.mode !== 'hard' && (
        <div className="offer-grid ten">
          {draft.offers.map(offer => (
            <button
              key={offer.species}
              className="offer-card"
              onClick={() => dispatch({type: 'SET_DRAFT', draft: pickSpecies(draft, data.sets, offer.species)})}
            >
              <span style={Icons.getPokemon(offer.species).css} />
              <span className="offer-name">{offer.species}</span>
              <TypeBadges species={offer.species} />
              <span className="mono usage">{(offer.usageWeighted * 100).toFixed(1)}%</span>
            </button>
          ))}
        </div>
      )}

      {draft.phase === 'set' && draft.setOptions && (
        <div className="offer-grid sets">
          {draft.setOptions.map(option => (
            <SetCard
              key={option.setName}
              option={option}
              onPick={() => dispatch({type: 'SET_DRAFT', draft: pickSet(draft, data.pool, data.sets, option.setName)})}
            />
          ))}
        </div>
      )}

      {draft.phase === 'species' && draft.mode === 'hard' && (
        <div className="offer-grid bundles">
          {draft.offers.map((offer, index) => (
            <button
              key={offer.species}
              className="offer-card bundle"
              onClick={() => dispatch({type: 'SET_DRAFT', draft: pickBundle(draft, data.pool, data.sets, index)})}
            >
              <div className="bundle-head">
                <span style={Icons.getPokemon(offer.species).css} />
                <span className="offer-name">{offer.species}</span>
                <TypeBadges species={offer.species} />
              </div>
              <div className="mono bundle-set">{offer.setName}</div>
              <ul className="mono set-moves">
                {offer.set!.moves.map(move => (
                  <li key={move}>{move}</li>
                ))}
              </ul>
              <p className="mono set-meta">
                {offer.set!.item || 'No item'} · {offer.set!.nature}
                {offer.set!.teraType ? ` · Tera ${offer.set!.teraType}` : ''}
              </p>
            </button>
          ))}
        </div>
      )}

      <section className="tray">
        <h3>Your team</h3>
        <div className="tray-slots">
          {Array.from({length: TEAM_SIZE}, (_, i) => {
            const pick = draft.team[i];
            return (
              <div key={i} className={`tray-slot ${pick ? 'filled' : ''}`}>
                {pick ? (
                  <>
                    <span style={Icons.getPokemon(pick.species).css} />
                    <span className="tray-name">{pick.species}</span>
                    <span className="tray-set mono">{pick.setName}</span>
                  </>
                ) : (
                  <span className="tray-empty">—</span>
                )}
              </div>
            );
          })}
        </div>
        {draft.phase === 'complete' && (
          <button className="primary" onClick={startGauntlet}>
            Start the gauntlet
          </button>
        )}
      </section>

      <section className="ladder-preview">
        <h3>The gauntlet ahead</h3>
        <ol className="ladder">
          {state.opponents.map((opponent, i) => (
            <li key={i} className="ladder-rung">
              <span className="rung-number mono">{i + 1}</span>
              <span className="rung-name">{opponent.name}</span>
              <span className="archetype-tag">{classifyTeam(gen, opponent.sets).label}</span>
              <span className="rung-icons">
                {opponent.sets.map((set, j) => (
                  <span key={j} style={Icons.getPokemon(set.species).css} title={set.species} />
                ))}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {(dev.tera !== undefined || dev.configName === 'fast' || dev.seed !== undefined) && (
        <p className="hint mono">
          dev: {dev.seed !== undefined ? `seed=${dev.seed} ` : ''}
          {dev.configName === 'fast' ? 'config=fast ' : ''}
          {dev.tera !== undefined ? `TERA_AVAILABLE=${dev.tera}` : ''}
        </p>
      )}
    </main>
  );
}
