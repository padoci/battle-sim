import {useEffect} from 'react';

/**
 * Ask the browser to confirm before leaving while work is in flight.
 *
 * A gauntlet run is a multi-minute investment — draft six, then up to six
 * battles — and none of it survives a reload: the run lives in memory, so a
 * refresh lands on "No run in progress". A `Test your team` run is the same
 * bargain. Neither warned about it.
 *
 * This is deliberately only the warning. Resuming a run across a reload means
 * persisting search state and is a much larger piece of work; stopping the
 * accidental reload removes most of the loss for a few lines.
 *
 * Browsers ignore the custom string and show their own wording, and they only
 * honour the prompt at all once the user has interacted with the page — which
 * is always true by the time a run exists.
 */
export function useUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy channel; still required by some browsers to trigger the prompt.
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [active]);
}
