import {beforeEach, describe, expect, it} from 'vitest';
import {loadDraft} from '../../src/app/screens/TeamImport';

/**
 * The rename changed the localStorage key the pasted team is saved under.
 * Unlike the HTTP cache, that value is something the user typed and cannot be
 * re-fetched, so it is read forward rather than abandoned. This holds that
 * line: without the fallback, anyone who pasted a team and refreshed onto the
 * renamed build would find an empty box and have to go find their export again,
 * the exact failure the draft-saving feature exists to prevent.
 *
 * The store is stubbed rather than borrowed from jsdom, which supplies a
 * `window` but no `localStorage` at all here — the same absence the real
 * `loadDraft` guards with a try/catch for private-mode browsers.
 */
const KEY = 'teampreview:team-draft';
const LEGACY = 'battle-sim:team-draft';
const TEAM = 'Great Tusk @ Heavy-Duty Boots\nAbility: Protosynthesis\n- Headlong Rush';

function stubStorage(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as {localStorage?: unknown}).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  return map;
}

let store: Map<string, string>;
beforeEach(() => {
  store = stubStorage();
});

describe('draft key rename', () => {
  it('reads a draft saved under the current key', () => {
    store.set(KEY, TEAM);
    expect(loadDraft()).toBe(TEAM);
  });

  it('carries a pre-rename draft forward instead of losing it', () => {
    store.set(LEGACY, TEAM);
    expect(loadDraft()).toBe(TEAM);
    // Moved, not copied: the next read comes from the current key, and the old
    // one stops lingering in storage.
    expect(store.get(KEY)).toBe(TEAM);
    expect(store.has(LEGACY)).toBe(false);
  });

  it('prefers the current key when both exist, so a newer draft wins', () => {
    store.set(LEGACY, 'stale team');
    store.set(KEY, TEAM);
    expect(loadDraft()).toBe(TEAM);
    // The stale value must not be promoted over the newer one.
    expect(store.get(KEY)).toBe(TEAM);
  });

  it('returns empty for a first-time visitor', () => {
    expect(loadDraft()).toBe('');
  });

  it('treats a deliberately cleared draft as empty, not a reason to resurrect the old one', () => {
    store.set(KEY, '');
    store.set(LEGACY, 'a team the user already cleared');
    expect(loadDraft()).toBe('');
  });

  it('still returns empty when storage throws (private mode)', () => {
    (globalThis as {localStorage?: unknown}).localStorage = {
      getItem() {
        throw new Error('SecurityError');
      },
    };
    expect(loadDraft()).toBe('');
  });
});
