import {Suspense, lazy, useReducer} from 'react';
import {ErrorBoundary} from './ErrorBoundary';
import {useRoute} from './router';
import {AppDispatchContext, AppStateContext, appReducer, initialState} from './state';
import {
  SixOhDispatchContext,
  SixOhStateContext,
  initialSixOhState,
  sixOhReducer,
} from './sixoh/state';
// Landing is the first paint and pulls no engine/data, so it stays eager. Every
// other screen imports the data client / @pkmn/dex (`resolve`, ~8 MB) and the
// engine, so they're split into async chunks that load on navigation — the
// landing page no longer downloads them up front. (Named exports → default.)
import {Landing} from './screens/Landing';
const TeamImport = lazy(() => import('./screens/TeamImport').then(m => ({default: m.TeamImport})));
const ConfigureRun = lazy(() => import('./screens/ConfigureRun').then(m => ({default: m.ConfigureRun})));
const Dashboard = lazy(() => import('./screens/Dashboard').then(m => ({default: m.Dashboard})));
const SixOhDraft = lazy(() => import('./screens/SixOhDraft').then(m => ({default: m.SixOhDraft})));
const SixOhGauntlet = lazy(() => import('./screens/SixOhGauntlet').then(m => ({default: m.SixOhGauntlet})));
const SixOhResult = lazy(() => import('./screens/SixOhResult').then(m => ({default: m.SixOhResult})));

function Screen() {
  const route = useRoute();
  switch (route) {
    case 'landing':
      return <Landing />;
    case 'test-import':
      return <TeamImport />;
    case 'test-configure':
      return <ConfigureRun />;
    case 'test-results':
      return <Dashboard />;
    case 'sixoh-draft':
      return <SixOhDraft />;
    case 'sixoh-gauntlet':
      return <SixOhGauntlet />;
    case 'sixoh-result':
      return <SixOhResult />;
  }
}

export function AppShell() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [sixOhState, sixOhDispatch] = useReducer(sixOhReducer, initialSixOhState);
  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <SixOhStateContext.Provider value={sixOhState}>
          <SixOhDispatchContext.Provider value={sixOhDispatch}>
          <div className="shell">
            <header className="shell-header">
              <a className="brand" href="#">
                battle-sim
              </a>
              <div className="tier-control" role="group" aria-label="Format">
                <button className="tier active">Gen 9 OU</button>
                <button className="tier" disabled title="Coming later">
                  VGC<span className="soon-badge">soon</span>
                </button>
              </div>
            </header>
            <ErrorBoundary>
              <Suspense fallback={<div className="route-loading mono">Loading…</div>}>
                <Screen />
              </Suspense>
            </ErrorBoundary>
            <footer className="shell-footer mono">
              <p>
                Battle data from{' '}
                <a href="https://data.pkmn.cc" target="_blank" rel="noreferrer">
                  data.pkmn.cc
                </a>{' '}
                (Smogon community data) · simulation by{' '}
                <a href="https://github.com/pkmn/ps" target="_blank" rel="noreferrer">
                  @pkmn
                </a>{' '}
                / Pokémon Showdown · sprites from Showdown&rsquo;s CDN.
              </p>
              <p>
                A fan project — not affiliated with Nintendo, Game Freak, The Pokémon Company, or
                Smogon.
              </p>
            </footer>
          </div>
        </SixOhDispatchContext.Provider>
      </SixOhStateContext.Provider>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}
