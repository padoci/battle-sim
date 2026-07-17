import {useEffect, useMemo, useState} from 'react';
import {Icons} from '@pkmn/img';
import {DataClient} from '../../data/client';
import {teamMemberToSet} from '../../data/team';
import {gen9} from '../../data/gen';
import {classifyTeam} from '../../analysis/archetype';
import {CALIBRATION_BATTLES, etaMs, formatEta} from '../../run/calibration';
import {cancelRun, getRunner} from '../simSession';
import {navigate} from '../router';
import {useAppDispatch, useAppState, type PoolEntryWithMeta} from '../state';

function PoolRow({entry}: {entry: PoolEntryWithMeta}) {
  const dispatch = useAppDispatch();
  return (
    <tr className={entry.enabled ? '' : 'pool-row-off'}>
      <td>
        <input
          type="checkbox"
          checked={entry.enabled}
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
        <input
          className="weight-input"
          type="number"
          min={0}
          max={9}
          value={entry.weight}
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

  // Load + classify the opponent pool once.
  useEffect(() => {
    if (state.pool.length > 0) return;
    const dataClient = new DataClient('gen9ou');
    dataClient
      .teams()
      .then(teams => {
        const pool: PoolEntryWithMeta[] = teams.map((team, index) => {
          const sets = team.data.map(teamMemberToSet);
          return {
            teamId: `team-${index}`,
            teamName: team.name ?? `Team #${index + 1}`,
            team: sets,
            weight: 1,
            enabled: true,
            archetype: classifyTeam(gen, sets),
          };
        });
        dispatch({type: 'SET_POOL', pool});
      })
      .catch(error => setPoolError(String(error)));
  }, [state.pool.length, dispatch, gen]);

  const {run, team, pool} = state;
  const enabledCount = pool.filter(p => p.enabled && p.weight > 0).length;
  const done = run.battles.length;

  if (!team) {
    return (
      <main className="screen">
        <p>
          No team yet — <a href="#/test/import">paste one first</a>.
        </p>
      </main>
    );
  }

  const calibrate = async () => {
    dispatch({type: 'RUN_STATUS', status: 'calibrating'});
    try {
      const runner = getRunner(team.sets);
      const outcome = await runner.calibrate(pool, update => {
        dispatch({
          type: 'BATTLE_DONE',
          battle: {teamId: update.teamId, result: update.result},
          emaMsPerBattle: update.emaMsPerBattle,
        });
      });
      dispatch({type: 'CALIBRATED', msPerBattleP50: outcome.msPerBattleP50});
    } catch (error) {
      dispatch({type: 'RUN_STATUS', status: 'error', error: String(error)});
    }
  };

  const runFull = async () => {
    dispatch({type: 'RUN_STATUS', status: 'running'});
    try {
      const runner = getRunner(team.sets);
      const outcome = await runner.extend(run.n, done, update => {
        dispatch({
          type: 'BATTLE_DONE',
          battle: {teamId: update.teamId, result: update.result},
          emaMsPerBattle: update.emaMsPerBattle,
        });
      });
      dispatch({type: 'RUN_STATUS', status: outcome.aborted ? 'cancelled' : 'done'});
      navigate('test-results');
    } catch (error) {
      dispatch({type: 'RUN_STATUS', status: 'error', error: String(error)});
    }
  };

  const remainingEta = formatEta(etaMs(run.n, done, run.emaMsPerBattle || run.msPerBattleP50));

  return (
    <main className="screen">
      <h1>Configure &amp; run</h1>
      <p className="screen-sub">
        Your team fights a weighted field of real meta teams. Weight a matchup up to pressure-test it.
      </p>

      {poolError && <p className="problems">Failed to load the opponent pool: {poolError}</p>}

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
            <PoolRow key={entry.teamId} entry={entry} />
          ))}
        </tbody>
      </table>

      {run.status === 'idle' && (
        <section className="run-controls">
          <button className="primary" disabled={enabledCount === 0} onClick={calibrate}>
            Calibrate ({CALIBRATION_BATTLES} quick battles)
          </button>
          <p className="hint">
            We measure this device's speed first, so the battle-count picker shows a real time estimate.
            Calibration battles count toward your total.
          </p>
        </section>
      )}

      {run.status === 'calibrating' && (
        <section className="run-controls">
          <p className="mono">
            Calibrating… {done}/{Math.min(CALIBRATION_BATTLES, enabledCount * 3)}
          </p>
        </section>
      )}

      {run.status === 'calibrated' && (
        <section className="run-controls">
          <label>
            Battles: <strong className="mono">{run.n}</strong>
            <input
              type="range"
              min={Math.max(10, done)}
              max={500}
              step={10}
              value={run.n}
              onChange={event => dispatch({type: 'SET_N', n: Number(event.target.value)})}
            />
          </label>
          <p className="mono">
            {done} done · {remainingEta} for the rest
          </p>
          <p className="hint">
            ~10 is a gut-check; a few hundred makes the win rates trustworthy.
          </p>
          <button className="primary" onClick={runFull}>
            Run {run.n} battles
          </button>
        </section>
      )}

      {run.status === 'running' && (
        <section className="run-controls">
          <progress value={done} max={run.n} />
          <p className="mono">
            {done}/{run.n} · {remainingEta} remaining
          </p>
          <button onClick={cancelRun}>Cancel (keep partial results)</button>
          <button onClick={() => navigate('test-results')}>Peek at partial results</button>
        </section>
      )}

      {(run.status === 'done' || run.status === 'cancelled') && (
        <section className="run-controls">
          <p className="mono">
            {done} battles {run.status === 'cancelled' ? '(cancelled early)' : 'complete'}
          </p>
          <button className="primary" onClick={() => navigate('test-results')}>
            View the dashboard
          </button>
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
