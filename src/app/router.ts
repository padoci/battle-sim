import {useEffect, useState} from 'react';

/**
 * Hand-rolled hash router (ui-spec §8: "a light hash router is enough; no
 * framework router required"). Route state is only WHICH screen — team,
 * pool, and run data live in AppState.
 */
export type Screen =
  | 'landing'
  | 'test-import'
  | 'test-configure'
  | 'test-results'
  | 'sixoh-draft'
  | 'sixoh-gauntlet'
  | 'sixoh-result';

const ROUTES: Array<[string, Screen]> = [
  ['', 'landing'],
  ['/test/import', 'test-import'],
  ['/test/configure', 'test-configure'],
  ['/test/results', 'test-results'],
  ['/sixoh', 'sixoh-draft'],
  ['/sixoh/gauntlet', 'sixoh-gauntlet'],
  ['/sixoh/result', 'sixoh-result'],
];

export function parseHash(hash: string): Screen {
  // Tolerate a dev query suffix: '#/sixoh?seed=1&config=fast'.
  const path = hash.replace(/^#/, '').split('?')[0];
  return ROUTES.find(([route]) => route === path)?.[1] ?? 'landing';
}

export function screenToHash(screen: Screen): string {
  return `#${ROUTES.find(([, s]) => s === screen)?.[0] ?? ''}`;
}

export function navigate(screen: Screen): void {
  // Carry the dev/tuning query (?seed=&config=&tera=&speed=) across in-app
  // navigation: without this, params set on the draft URL silently never
  // reached the gauntlet screen's readDevParams (config/tera/speed applied
  // to the draft only), which contradicted devParams.ts's documented use.
  const query = location.hash.split('?')[1];
  location.hash = screenToHash(screen) + (query ? `?${query}` : '');
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
