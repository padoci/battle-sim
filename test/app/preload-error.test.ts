import {describe, expect, it} from 'vitest';
import {
  isPreloadError,
  makePreloadErrorHandler,
  PRELOAD_RELOAD_KEY,
} from '../../src/app/preloadError';

/**
 * The stale-chunk-after-redeploy bug. Two properties matter and they pull in
 * opposite directions: a first failure MUST reload (otherwise every user with
 * the tab open at deploy time hits a dead screen), and a repeat failure MUST
 * NOT (otherwise a genuinely-missing chunk boot-loops the browser).
 */

class FakeStorage {
  private map = new Map<string, string>();
  constructor(private readonly throws = false) {}
  getItem(key: string) {
    if (this.throws) throw new Error('storage disabled');
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.throws) throw new Error('storage disabled');
    this.map.set(key, value);
  }
}

function fakeEvent() {
  let defaultPrevented = false;
  return {
    event: {preventDefault: () => (defaultPrevented = true)} as unknown as Event,
    get prevented() {
      return defaultPrevented;
    },
  };
}

describe('preload error handler', () => {
  it('reloads once on the first stale-chunk failure', () => {
    const storage = new FakeStorage();
    let reloads = 0;
    const handler = makePreloadErrorHandler({storage, reload: () => reloads++});
    const {event, prevented: _p} = fakeEvent();
    handler(event);
    expect(reloads).toBe(1);
    expect(storage.getItem(PRELOAD_RELOAD_KEY)).toBe('1');
  });

  it('does NOT reload again — a persistent 404 must not boot-loop', () => {
    const storage = new FakeStorage();
    let reloads = 0;
    const handler = makePreloadErrorHandler({storage, reload: () => reloads++});
    for (let i = 0; i < 5; i++) handler(fakeEvent().event);
    expect(reloads).toBe(1);
  });

  it('preventDefault()s only the attempt it actually handles', () => {
    const storage = new FakeStorage();
    const handler = makePreloadErrorHandler({storage, reload: () => {}});
    const first = fakeEvent();
    handler(first.event);
    expect(first.prevented).toBe(true);
    const second = fakeEvent();
    handler(second.event);
    // Not handled -> falls through to the ErrorBoundary with real copy.
    expect(second.prevented).toBe(false);
  });

  it('never reloads when sessionStorage is unavailable', () => {
    // Without somewhere to record the one-shot, a reload could loop forever.
    let reloads = 0;
    makePreloadErrorHandler({storage: undefined, reload: () => reloads++})(fakeEvent().event);
    makePreloadErrorHandler({storage: new FakeStorage(true), reload: () => reloads++})(
      fakeEvent().event
    );
    expect(reloads).toBe(0);
  });
});

describe('isPreloadError', () => {
  it('recognises the Vite messages and nothing else', () => {
    expect(isPreloadError(new Error('Failed to fetch dynamically imported module: /a.js'))).toBe(true);
    expect(isPreloadError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isPreloadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isPreloadError('some string')).toBe(false);
  });
});
