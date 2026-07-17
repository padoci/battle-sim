import {useReducer} from 'react';
import {ErrorBoundary} from './ErrorBoundary';
import {useRoute} from './router';
import {AppDispatchContext, AppStateContext, appReducer, initialState} from './state';
import {
  SixOhDispatchContext,
  SixOhStateContext,
  initialSixOhState,
  sixOhReducer,
} from './sixoh/state';
import {Landing} from './screens/Landing';
import {TeamImport} from './screens/TeamImport';
import {ConfigureRun} from './screens/ConfigureRun';
import {Dashboard} from './screens/Dashboard';
import {SixOhDraft} from './screens/SixOhDraft';
import {SixOhGauntlet} from './screens/SixOhGauntlet';
import {SixOhResult} from './screens/SixOhResult';

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
              <Screen />
            </ErrorBoundary>
          </div>
        </SixOhDispatchContext.Provider>
      </SixOhStateContext.Provider>
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}
