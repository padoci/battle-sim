/**
 * Every screen but Landing is `lazy()`, so the app fetches a hashed chunk on
 * navigation. Cloudflare Pages redeploys replace those hashes: anyone holding
 * the previous index.html gets a 404 the moment they leave the landing screen,
 * and Vite surfaces it as a `vite:preloadError` event. Untreated it reaches the
 * ErrorBoundary as "Failed to fetch dynamically imported module: …" — which is
 * both the most likely error a real user sees after a deploy and the least
 * useful thing to show them.
 *
 * Reloading picks up the new index.html and fixes it. But an UNCONDITIONAL
 * reload is a boot loop when the chunk is genuinely gone (a bad deploy, a proxy
 * serving a stale index), so this reloads at most once per tab: the second
 * occurrence falls through to the boundary with a message that actually says
 * what happened.
 */
export const PRELOAD_RELOAD_KEY = 'battlesim.preloadReload';

export interface PreloadErrorDeps {
  /** sessionStorage, or a stand-in. Undefined when storage is unavailable. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  reload: () => void;
}

/**
 * Returns the handler (already registered when `target` is given) so a test can
 * drive it directly. Safe to call with no storage: without a one-shot record we
 * must NOT reload, or a persistent 404 loops forever.
 */
export function makePreloadErrorHandler({storage, reload}: PreloadErrorDeps): (event: Event) => void {
  return event => {
    let alreadyTried = true;
    try {
      alreadyTried = storage?.getItem(PRELOAD_RELOAD_KEY) === '1';
      storage?.setItem(PRELOAD_RELOAD_KEY, '1');
    } catch {
      // Private mode / storage disabled: treat as "already tried" so we fall
      // through to the boundary rather than risk a reload loop.
      alreadyTried = true;
    }
    if (storage && !alreadyTried) {
      event.preventDefault();
      reload();
    }
    // Otherwise: let it propagate. The boundary shows the message below.
  };
}

/** Human copy for a chunk that stayed missing after the one retry. */
export const STALE_BUILD_MESSAGE =
  'A new version of the site was deployed while this tab was open. Reload to continue.';

export function isPreloadError(error: unknown): boolean {
  return /Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(
    error instanceof Error ? error.message : String(error)
  );
}

export function installPreloadErrorHandler(deps: PreloadErrorDeps, target: EventTarget = window): void {
  target.addEventListener('vite:preloadError', makePreloadErrorHandler(deps));
}
