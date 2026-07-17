import {useReducer} from 'react';
import {useRoute} from './router';
import {AppDispatchContext, AppStateContext, appReducer, initialState} from './state';
import {Landing} from './screens/Landing';
import {TeamImport} from './screens/TeamImport';
import {ConfigureRun} from './screens/ConfigureRun';
import {Dashboard} from './screens/Dashboard';

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
    case 'sixoh-soon':
      return (
        <main className="screen">
          <h1>Can you 6-0?</h1>
          <p>Coming soon — the draft gauntlet lands in the next stage.</p>
          <a href="#">Back</a>
        </main>
      );
  }
}

export function AppShell() {
  const [state, dispatch] = useReducer(appReducer, initialState);
  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>
        <div className="shell">
          <header className="shell-header">
            <a className="brand" href="#">
              battle-sim
            </a>
            <div className="tier-control" role="group" aria-label="Format">
              <button className="tier active">Gen 9 OU</button>
              <button className="tier" disabled title="Coming later">
                VGC
              </button>
            </div>
          </header>
          <Screen />
        </div>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}
