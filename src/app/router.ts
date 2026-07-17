import {useEffect, useState} from 'react';

/**
 * Hand-rolled hash router (ui-spec §8: "a light hash router is enough; no
 * framework router required"). Route state is only WHICH screen — team,
 * pool, and run data live in AppState.
 */
export type Screen = 'landing' | 'test-import' | 'test-configure' | 'test-results' | 'sixoh-soon';

const ROUTES: Array<[string, Screen]> = [
  ['', 'landing'],
  ['/test/import', 'test-import'],
  ['/test/configure', 'test-configure'],
  ['/test/results', 'test-results'],
  ['/sixoh', 'sixoh-soon'],
];

export function parseHash(hash: string): Screen {
  const path = hash.replace(/^#/, '');
  return ROUTES.find(([route]) => route === path)?.[1] ?? 'landing';
}

export function screenToHash(screen: Screen): string {
  return `#${ROUTES.find(([, s]) => s === screen)?.[0] ?? ''}`;
}

export function navigate(screen: Screen): void {
  location.hash = screenToHash(screen);
}

export function useRoute(): Screen {
  const [screen, setScreen] = useState<Screen>(() => parseHash(location.hash));
  useEffect(() => {
    const onChange = () => setScreen(parseHash(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return screen;
}
