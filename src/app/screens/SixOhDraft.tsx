import {useEffect, useMemo, useState, type CSSProperties} from 'react';
import {Icons} from '@pkmn/img';
import {DataClient} from '../../data/client';
import {loadOpponentTeams} from '../../data/sampleTeams';
import {teamMemberToSet} from '../../data/team';
import {gen9} from '../../data/gen';
import type {PoolEntry, SetsData} from '../../data/types';
import {classifyTeam, fallbackTeamName} from '../../analysis/archetype';
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
import {typeColor, typeGradient, typeBorderGradient} from '../sixoh/typeColors';
import {readDevParams} from '../sixoh/devParams';
import {useSixOhDispatch, useSixOhState, type GauntletOpponent} from '../sixoh/state';
import {resetSixOhSession} from '../sixoh/session';
import {useTcgArt} from '../sixoh/useTcgArt';

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

/** The fanned hand's per-card rotation + arc dip, by distance from center —
 * generalizes to whatever offer count the draft engine deals (10 for
 * easy/normal, 6 for hard-mode bundles). */
function fanTransform(index: number, count: number, rotateStepDeg: number, dipPx: number): string {
  const center = (count - 1) / 2;
  const d = index - center;
  return `rotate(${(d * rotateStepDeg).toFixed(2)}deg) translateY(${(d * d * dipPx).toFixed(1)}px)`;
}

/** Card art window: the TCGdex print once resolved, or the @pkmn/img icon
 * (scaled up) while it loads / if no print was found. */
function CardArt({species}: {species: string}) {
  const url = useTcgArt(species);
  if (url) {
    return <img className="card-art" src={url} alt={species} loading="lazy" decoding="async" />;
  }
  return <span className="card-art-fallback" style={Icons.getPokemon(species).css} />;
}

function MoveList({moves}: {moves: string[]}) {
  const gen = gen9();
  return (
    <ul className="mono set-moves">
      {moves.map((move, i) => (
        <li key={i} style={{'--move-type-color': typeColor(gen.moves.get(move)?.type)} as CSSProperties}>
          {move}
        </li>
      ))}
    </ul>
  );
}

function SetCard({species, option, onPick}: {species: string; option: SetOption; onPick: () => void}) {
  // Render the RESOLVED set only — the card shows exactly the moves/tera
  // that will battle (the draft committed to one build per option; the wire
  // format's slashed alternatives are no longer re-expanded here).
  const {set} = option;
  const evs = Object.entries(set.evs)
    .filter(([, v]) => v > 0)
    .map(([stat, v]) => `${v} ${stat}`)
    .join(' / ');
  return (
    <button className="set-card" onClick={onPick}>
      <div className="bundle-head">
        <span className="mon-tile" style={{backgroundImage: typeGradient(gen9().species.get(species)?.types ?? [])}}>
          <span style={Icons.getPokemon(species).css} />
        </span>
        <div>
          <h4>{species}</h4>
          <div className="mono bundle-set">{option.setName}</div>
        </div>
      </div>
      <MoveList moves={set.moves} />
      <p className="mono set-meta">
        {set.item || 'No item'} · {set.nature} · {evs}
      </p>
      <p className="mono set-meta">Tera {set.teraType ?? '—'}</p>
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
        const opponents = opponentIndices.map(i => {
          const sets = teams[i].data.map(teamMemberToSet);
          return {name: teams[i].name ?? fallbackTeamName(gen, sets), sets};
        });
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
          {draft.phase === 'species' && (
            <span className="mono hint">
              your hand of {draft.offers.length} · hover to lift, click to draft
              {draft.mode === 'hard' ? ' the package' : ''}
            </span>
          )}
        </h2>
      )}

      {draft.phase === 'species' && draft.mode !== 'hard' && (
        <div className="offer-grid ten">
          {draft.offers.map((offer, index) => {
            const types = gen9().species.get(offer.species)?.types ?? [];
            return (
              <button
                key={offer.species}
                className="offer-card"
                style={{
                  transform: fanTransform(index, draft.offers.length, 4.4, 2.4),
                  zIndex: index,
                  background: `linear-gradient(#fdfbff, var(--panel-lilac)) padding-box, ${typeBorderGradient(types)} border-box`,
                }}
                onClick={() => dispatch({type: 'SET_DRAFT', draft: pickSpecies(draft, data.sets, offer.species)})}
              >
                <div className="card-art-window" style={{backgroundImage: typeGradient(types)}}>
                  <span className="mono usage">{(offer.usageWeighted * 100).toFixed(1)}%</span>
                  <CardArt species={offer.species} />
                </div>
                <div className="card-footer">
                  <span className="offer-name">{offer.species}</span>
                  <TypeBadges species={offer.species} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {draft.phase === 'set' && draft.setOptions && (
        <div className="offer-grid sets">
          {draft.setOptions.map(option => (
            <SetCard
              key={option.setName}
              species={draft.offers[0]?.species ?? ''}
              option={option}
              onPick={() => dispatch({type: 'SET_DRAFT', draft: pickSet(draft, data.pool, data.sets, option.setName)})}
            />
          ))}
        </div>
      )}

      {draft.phase === 'species' && draft.mode === 'hard' && (
        <div className="offer-grid bundles">
          {draft.offers.map((offer, index) => {
            const types = gen9().species.get(offer.species)?.types ?? [];
            return (
              <button
                key={offer.species}
                className="offer-card bundle"
                style={{
                  transform: fanTransform(index, draft.offers.length, 5.5, 3),
                  zIndex: index,
                  background: `linear-gradient(#fdfbff, #efe7fa) padding-box, ${typeBorderGradient(types)} border-box`,
                }}
                onClick={() => dispatch({type: 'SET_DRAFT', draft: pickBundle(draft, data.pool, data.sets, index)})}
              >
                <div className="card-art-window" style={{backgroundImage: typeGradient(types)}}>
                  <span className="mono usage">{(offer.usageWeighted * 100).toFixed(1)}%</span>
                  <CardArt species={offer.species} />
                </div>
                <div className="bundle-head">
                  <div style={{flex: 1, minWidth: 0}}>
                    <span className="offer-name">{offer.species}</span>
                    <div className="mono bundle-set">{offer.setName}</div>
                  </div>
                  <TypeBadges species={offer.species} />
                </div>
                <MoveList moves={offer.set!.moves} />
                <p className="mono set-meta">
                  {offer.set!.item || 'No item'} · {offer.set!.nature}
                  {offer.set!.teraType ? ` · Tera ${offer.set!.teraType}` : ''}
                </p>
              </button>
            );
          })}
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
                    <span className="mon-tile" style={{backgroundImage: typeGradient(gen9().species.get(pick.species)?.types ?? [])}}>
                      <CardArt species={pick.species} />
                    </span>
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
