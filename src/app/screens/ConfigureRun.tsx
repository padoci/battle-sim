import {useEffect, useMemo, useState} from 'react';
import {Icons} from '@pkmn/img';
import {DataClient} from '../../data/client';
import {loadOpponentTeams} from '../../data/sampleTeams';
import {teamMemberToSet} from '../../data/team';
import {gen9} from '../../data/gen';
import {classifyTeam, teamDisplayName} from '../../analysis/archetype';
import {getRunner} from '../simSession';
import {navigate} from '../router';
import {useAppDispatch, useAppState, type PoolEntryWithMeta} from '../state';

/** Same budget as SixOhDraft's load watchdog: above the ~10s a slow-but-
 * failing-over data fetch takes (cachedJson's per-URL timeout+mirror), with
 * headroom for a genuinely slow connection, but still a hard ceiling. */
const POOL_WATCHDOG_MS = 25_000;

function PoolRow({entry, locked}: {entry: PoolEntryWithMeta; locked: boolean}) {
  const dispatch = useAppDispatch();
  return (
    <tr className={entry.enabled ? '' : 'pool-row-off'}>
      <td>
        <input
          type="checkbox"
          checked={entry.enabled}
          disabled={locked}
          onChange={event =>
            dispatch({type: 'UPDATE_POOL_ENTRY', teamId: entry.teamId, patch: {enabled: event.target.checked}})
          }
        />
      </td>
      <td className="pool-name">{entry.teamName}</td>
      <td>
        <span className="archetype-tag" title={archetypeWhy(entry)}>
          {entry.archetype.label}
        </span>
      </td>
      <td className="pool-icons">
        {entry.team.map((set, i) => (
          <span key={i} style={Icons.getPokemon(set.species).css} title={set.species} />
        ))}
      </td>
      <td>
        <span className="field-label">Weight </span>
        <input
          className="weight-input"
          type="number"
          min={0}
          max={9}
          value={entry.weight}
          disabled={locked}
          onChange={event =>
            dispatch({
              type: 'UPDATE_POOL_ENTRY',
              teamId: entry.teamId,
              patch: {weight: Math.max(0, Math.min(9, Number(event.target.value) || 0))},
            })
          }
        />
      </td>
    </tr>
  );
}

function archetypeWhy(entry: PoolEntryWithMeta): string {
  const f = entry.archetype.features;
  const parts = [
    f.weatherSetter && `${f.weatherSetter.species} sets ${f.weatherSetter.weather}`,
    f.terrainSetter && `${f.terrainSetter.species} sets ${f.terrainSetter.terrain} terrain`,
    `${f.offensiveCount} offensive`,
    `${f.defensiveCount} defensive`,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function ConfigureRun() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const gen = useMemo(() => gen9(), []);
  const [poolError, setPoolError] = useState<string>();
  const [poolLoadElapsedMs, setPoolLoadElapsedMs] = useState(0);
  // In-progress text of the optional auto-stop input; committed on blur/Enter
  // (blank clears the bound), then reset to resync with run.autoStopN.
  const [autoStopDraft, setAutoStopDraft] = useState<string>();

  // Load + classify the opponent pool once. Guarded by a watchdog + elapsed-
  // time feedback, mirroring SixOhDraft's load effect: without it, a slow (not
  // down) data host left this table silently empty forever — no spinner, no
  // error, nothing to tell the user anything was happening — which is the
  // same underlying bug the "Dealing your first hand…" stall was, just with
  // no loading UI at all instead of a static one.
  useEffect(() => {
    if (state.pool.length > 0) return;
    let settled = false;
    const dataClient = new DataClient('gen9ou');
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      setPoolError('timed out loading the opponent pool, check your connection and reload');
    }, POOL_WATCHDOG_MS);
    const startedAt = Date.now();
    const ticker = setInterval(() => {
      if (settled) return;
      setPoolLoadElapsedMs(Date.now() - startedAt);
    }, 1000);
    loadOpponentTeams(dataClient)
      .then(teams => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        clearInterval(ticker);
        const pool: PoolEntryWithMeta[] = teams.map((team, index) => {
          const sets = team.data.map(teamMemberToSet);
          return {
            teamId: `team-${index}`,
            teamName: teamDisplayName(gen, sets),
            team: sets,
            weight: 1,
            enabled: true,
            archetype: classifyTeam(gen, sets),
          };
        });
        dispatch({type: 'SET_POOL', pool});
      })
      .catch(error => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        clearInterval(ticker);
        setPoolError(String(error));
      });
    return () => {
      settled = true;
      clearTimeout(watchdog);
      clearInterval(ticker);
    };
  }, [state.pool.length, dispatch, gen]);

  const {run, team, pool} = state;
  const enabledCount = pool.filter(p => p.enabled && p.weight > 0).length;
  // A weight/enabled edit only ever reaches the scheduler when the next
  // run() call re-inits it - once a run is in flight (or finished) there's
  // no way to feed an edit back in, so lock the table rather than let it
  // silently do nothing.
  const poolLocked = run.status !== 'idle';

  if (!team) {
    return (
      <main className="screen">
        <div className="empty-state">
          No team loaded yet, <a href="#/test/import">paste one to analyze</a> and come back.
        </div>
      </main>
    );
  }

  if (poolError) {
    return (
      <main className="screen">
        <p className="problems">Couldn't load the opponent pool: {poolError}. Check your connection and reload.</p>
      </main>
    );
  }

  if (pool.length === 0) {
    return (
      <main className="screen">
        <div className="empty-state">
          Loading the opponent pool…
          {poolLoadElapsedMs > 3000 && (
            <p className="load-status mono">
              {poolLoadElapsedMs > 7000
                ? 'still working, the tier data host is responding slowly right now, hang tight'
                : 'fetching the latest tier data…'}
            </p>
          )}
        </div>
      </main>
    );
  }

  const startRun = () => {
    dispatch({type: 'RUN_STATUS', status: 'running'});
    // Land on the live dashboard immediately; the loop below outlives this
    // screen (dispatch comes from the app-level provider, and the runner
    // lives in simSession, so navigation never interrupts the run).
    navigate('test-results');
    const runner = getRunner(team.sets);
    runner
      .run(pool, {
        autoStopN: run.autoStopN,
        onUpdate: update => {
          dispatch({
            type: 'BATTLE_DONE',
            battle: {teamId: update.teamId, result: update.result},
            emaMsPerBattle: update.emaMsPerBattle,
          });
        },
      })
      .then(() => dispatch({type: 'RUN_STATUS', status: 'done'}))
      .catch(error => dispatch({type: 'RUN_STATUS', status: 'error', error: String(error)}));
  };

  const commitAutoStop = () => {
    if (autoStopDraft === undefined) return;
    const parsed = Math.floor(Number(autoStopDraft));
    dispatch({type: 'SET_AUTO_STOP', n: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined});
    setAutoStopDraft(undefined); // resync display to run.autoStopN either way
  };

  return (
    <main className="screen">
      <h1>Configure &amp; run</h1>
      <p className="screen-sub">
        Your team fights a weighted field of real meta teams. Weight a matchup up to pressure-test it.
      </p>

      <div className="table-scroll">
        <table className="pool-table">
          <thead>
            <tr>
              <th />
              <th>Team</th>
              <th>Archetype</th>
              <th>Roster</th>
              <th>Weight</th>
            </tr>
          </thead>
          <tbody>
            {pool.map(entry => (
              <PoolRow key={entry.teamId} entry={entry} locked={poolLocked} />
            ))}
          </tbody>
        </table>
      </div>
      {poolLocked && (
        <p className="hint">Pool locks once a run starts, cancel and reset to change it.</p>
      )}

      {run.status === 'idle' && (
        <section className="run-controls">
          <label className="n-input-label mono">
            auto-stop after{' '}
            <input
              type="number"
              className="n-input mono"
              min={1}
              placeholder="∞"
              value={autoStopDraft ?? run.autoStopN ?? ''}
              aria-label="Auto-stop after this many battles (optional)"
              onChange={event => setAutoStopDraft(event.target.value)}
              onBlur={commitAutoStop}
              onKeyDown={event => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
              }}
            />{' '}
            battles (optional)
          </label>
          <p className="hint">
            Leave it blank to run until you hit Stop. The dashboard fills in live either way, and
            stopping at any point keeps a fair sample of the pool.
          </p>
          <button className="primary" disabled={enabledCount === 0} onClick={startRun}>
            Run
          </button>
        </section>
      )}

      {(run.status === 'running' || run.status === 'done') && (
        <section className="run-controls">
          <p className="mono" role="status" aria-live="polite">
            {run.battles.length} battle{run.battles.length === 1 ? '' : 's'}
            {run.status === 'running' ? ' and counting…' : ' recorded'}
          </p>
          <button className="primary" onClick={() => navigate('test-results')}>
            {run.status === 'running' ? 'Back to the live dashboard' : 'View the dashboard'}
          </button>
          {run.status === 'done' && (
            <button onClick={() => dispatch({type: 'RESET_RUN'})}>Reset (unlock the pool)</button>
          )}
        </section>
      )}

      {run.status === 'error' && (
        <section className="run-controls">
          <p className="problems">Run failed: {run.error}</p>
          <button onClick={() => dispatch({type: 'RESET_RUN'})}>Reset</button>
        </section>
      )}
    </main>
  );
}
