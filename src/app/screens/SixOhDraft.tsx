import {useEffect, useMemo, useState, type CSSProperties} from 'react';
import {Icons} from '@pkmn/img';
import {DataClient} from '../../data/client';
import {loadOpponentTeams} from '../../data/sampleTeams';
import {loadGymLeaderTeams} from '../../data/gymLeaderTeams';
import {teamMemberToSet} from '../../data/team';
import {gen9} from '../../data/gen';
import type {GymLeaderTeam, PoolEntry, SetsData, Team} from '../../data/types';
import {classifyTeam, teamDisplayName} from '../../analysis/archetype';
import {createDraft, pickBundle, TEAM_SIZE, type DraftMode} from '../../draft/draft';
import {sampleGymLeaders, sampleOpponents} from '../../draft/opponents';
import {navigate} from '../router';
import {typeColor, typeGradient, typeBorderGradient} from '../sixoh/typeColors';
import {readDevParams} from '../sixoh/devParams';
import {useSixOhDispatch, useSixOhState, type GauntletOpponent} from '../sixoh/state';
import {resetSixOhSession} from '../sixoh/session';
import {useTcgArt} from '../sixoh/useTcgArt';
import {resizedCardArtUrl} from '../../data/tcgArt';
import {TrainerPortrait} from '../components/TrainerPortrait';
import type {Generation} from '@pkmn/data';

/** Above the ~10s a slow-but-failing-over data fetch takes (see cachedJson's
 * per-URL timeout) with headroom for a genuinely slow connection, but still a
 * hard ceiling so a stall never spins forever. */
const LOAD_WATCHDOG_MS = 25_000;

interface DraftData {
  pool: PoolEntry[];
  sets: SetsData;
  /** Easy/Hard opponent pool: real meta teams. */
  realTeams: Team[];
  /** Gym Leader opponent pool: real trainers' rosters. */
  gymLeaderTeams: GymLeaderTeam[];
}

/** Generic trainer sprites for Easy/Hard opponents (verified present on
 * Showdown's /sprites/trainers/ CDN) so every mode gets a face on the ladder
 * and a full battle intro, not just Gym Leader. */
const GENERIC_AVATARS = [
  'acetrainer',
  'acetrainerf',
  'youngster',
  'lass',
  'hiker',
  'blackbelt',
  'scientist',
  'psychic',
  'battlegirl',
  'veteran',
  'pokefan',
  'schoolkid',
  'swimmer',
  'roughneck',
  'waitress',
];
/** Strides coprime with GENERIC_AVATARS.length (15), so the 6 rungs of one
 * run always get 6 DISTINCT sprites, while staying a pure function of the
 * run seed (stable across replays/re-renders, varied across runs). */
const AVATAR_STRIDES = [1, 2, 4, 7, 8, 11, 13, 14];

function genericAvatar(seed: number, rung: number): string {
  const offset = Math.abs(seed) % GENERIC_AVATARS.length;
  const stride = AVATAR_STRIDES[Math.abs(seed >> 4) % AVATAR_STRIDES.length];
  return GENERIC_AVATARS[(offset + rung * stride) % GENERIC_AVATARS.length];
}

/** This mode's 6 gauntlet opponents for a given seed — a different pool and
 * sampler for Gym Leader (5 distinct-signature-type leaders + a champion)
 * than Easy/Hard (uniform draw from the real-team pool). */
function buildOpponents(mode: DraftMode, data: DraftData, seed: number, gen: Generation): GauntletOpponent[] {
  if (mode === 'gymleader') {
    return sampleGymLeaders(data.gymLeaderTeams, seed).map(i => {
      const team = data.gymLeaderTeams[i];
      const name = team.name ?? team.signatureType;
      return {
        name,
        sets: team.data.map(teamMemberToSet),
        badge: team.isChampion ? `${team.signatureType} · Champion` : team.signatureType,
        avatarKey: team.name?.toLowerCase(),
      };
    });
  }
  return sampleOpponents(data.realTeams.length, 6, seed).map((teamIndex, rung) => {
    const sets = data.realTeams[teamIndex].data.map(teamMemberToSet);
    return {name: teamDisplayName(gen, sets), sets, avatarKey: genericAvatar(seed, rung)};
  });
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

/** The fanned hand's per-card rotation + arc dip, by distance from center. */
function fanTransform(index: number, count: number, rotateStepDeg: number, dipPx: number): string {
  const center = (count - 1) / 2;
  const d = index - center;
  return `rotate(${(d * rotateStepDeg).toFixed(2)}deg) translateY(${(d * d * dipPx).toFixed(1)}px)`;
}

/** Card art window: the TCGdex print once resolved, or the @pkmn/img icon
 * (scaled up) while it loads / if no print was found. Tries the resized
 * (much smaller) proxy URL first; if that ever fails to load (the proxy is
 * down or blocked), falls back to fetching the direct TCGdex URL instead of
 * showing nothing. */
function CardArt({species}: {species: string}) {
  const url = useTcgArt(species);
  const [proxyFailed, setProxyFailed] = useState(false);
  if (url) {
    const src = proxyFailed ? url : resizedCardArtUrl(url);
    return (
      <img
        className="card-art"
        src={src}
        onError={() => setProxyFailed(true)}
        alt={species}
        loading="lazy"
        decoding="async"
      />
    );
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

export function SixOhDraft() {
  const state = useSixOhState();
  const dispatch = useSixOhDispatch();
  const [data, setData] = useState<DraftData>();
  const [error, setError] = useState<string>();
  const [loadElapsedMs, setLoadElapsedMs] = useState(0);
  const gen = useMemo(() => gen9(), []);
  const dev = useMemo(() => readDevParams(), []);
  // Starting difficulty from the hash (`#/sixoh?mode=hard`) so "Step up" and
  // "Draft again" can pick the mode; defaults to Gym Leader (the entry tier).
  const initialMode = useMemo<DraftMode>(() => {
    const raw = new URLSearchParams(location.hash.split('?')[1] ?? '').get('mode');
    return raw === 'easy' || raw === 'hard' || raw === 'gymleader' ? raw : 'gymleader';
  }, []);

  // Load pool + sets + both opponent pools, then deal the first hand. Guarded
  // by a watchdog: a stall anywhere in this chain (a slow/hung fetch,
  // IndexedDB taking unusually long to open, a slow synchronous
  // TeamValidator pass over the opponent pool) would otherwise leave "Dealing
  // your first hand…" spinning forever with no way out but a manual reload.
  // The race surfaces the same error panel a rejection already gets, on a
  // bounded timeout instead of an indefinite hang.
  useEffect(() => {
    if (state.draft || data) return;
    let settled = false;
    const client = new DataClient('gen9ou');
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      setError('timed out loading the draft data, check your connection and reload');
    }, LOAD_WATCHDOG_MS);
    // A slow-but-healthy fetch (the third-party data host being slow that
    // moment, or a first visit with nothing cached yet — see cachedJson's
    // per-URL timeout+failover) looks IDENTICAL to a hung one without this:
    // a static "Dealing your first hand…" with no sense of elapsed time reads
    // as broken well before the 25s watchdog, and is the direct cause of
    // users refreshing a load that was actually still progressing normally.
    const startedAt = Date.now();
    const ticker = setInterval(() => {
      if (settled) return;
      setLoadElapsedMs(Date.now() - startedAt);
    }, 1000);
    Promise.all([client.pool(), client.sets(), loadOpponentTeams(client)])
      .then(([pool, sets, realTeams]) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        clearInterval(ticker);
        const loaded: DraftData = {pool, sets, realTeams, gymLeaderTeams: loadGymLeaderTeams()};
        const seed = dev.seed ?? Math.floor(Math.random() * 2 ** 31);
        const opponents = buildOpponents(initialMode, loaded, seed ^ 0x0bb57, gen);
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
      .catch(e => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        clearInterval(ticker);
        setError(String(e));
      });
    return () => {
      settled = true;
      clearTimeout(watchdog);
      clearInterval(ticker);
    };
  }, [state.draft, data, dispatch, dev.seed, initialMode, gen]);

  const draft = state.draft;
  const canSwitchMode = draft && draft.team.length === 0 && draft.phase === 'drafting';

  // Switching mode before any pick is, in effect, starting the run over in
  // that mode — the opponent pool/sampler differs per mode, so both the
  // draft and the gauntlet ladder are re-rolled together.
  const switchMode = (mode: DraftMode) => {
    if (!data || !canSwitchMode || mode === draft.mode) return;
    const seed = state.runSeed;
    dispatch({
      type: 'NEW_RUN',
      seed,
      mode,
      draft: createDraft(data.pool, data.sets, mode, seed ^ 0xd4af7),
      opponents: buildOpponents(mode, data, seed ^ 0x0bb57, gen),
    });
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
        <div className="empty-state">
          Dealing your first hand…
          {loadElapsedMs > 3000 && (
            <p className="load-status mono">
              {loadElapsedMs > 7000
                ? 'still working, the tier data host is responding slowly right now, hang tight'
                : 'fetching the latest tier data…'}
            </p>
          )}
        </div>
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
        Draft six pre-made cards. Then the AI pilots them through a six-battle gauntlet, win all
        six to go flawless.
      </p>

      <div className="mode-toggle" role="group" aria-label="Difficulty">
        <button
          className={draft.mode === 'gymleader' ? 'active' : ''}
          disabled={!canSwitchMode && draft.mode !== 'gymleader'}
          onClick={() => switchMode('gymleader')}
        >
          Gym Leader <span className="hint">6 options: real gym leaders, building to a champion finale</span>
        </button>
        <button
          className={draft.mode === 'easy' ? 'active' : ''}
          disabled={!canSwitchMode && draft.mode !== 'easy'}
          onClick={() => switchMode('easy')}
        >
          Easy <span className="hint">6 options: opponents start weak and ramp up</span>
        </button>
        <button
          className={draft.mode === 'hard' ? 'active' : ''}
          disabled={!canSwitchMode && draft.mode !== 'hard'}
          onClick={() => switchMode('hard')}
        >
          Hard <span className="hint">6 options: full-strength opponents from rung one</span>
        </button>
      </div>

      {draft.phase !== 'complete' && (
        <h2 className="round-header">
          Pick {draft.team.length + 1} of {TEAM_SIZE}
          <span className="mono hint">your hand of {draft.offers.length} · hover to lift, click to draft the package</span>
        </h2>
      )}

      {draft.phase === 'drafting' && (
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
                <MoveList moves={offer.set.moves} />
                <p className="mono set-meta">
                  {offer.set.item || 'No item'} · {offer.set.nature}
                  {offer.set.teraType ? ` · Tera ${offer.set.teraType}` : ''}
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
                  <span className="tray-empty">–</span>
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
              {opponent.avatarKey && <TrainerPortrait avatarKey={opponent.avatarKey} className="rung-portrait" />}
              <span className="rung-name">{opponent.name}</span>
              <span className="archetype-tag">{opponent.badge ?? classifyTeam(gen, opponent.sets).label}</span>
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
