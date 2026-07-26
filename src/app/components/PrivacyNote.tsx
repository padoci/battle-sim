/**
 * The reassurance that belongs next to a paste box.
 *
 * A competitive team is work someone has put hours into, and pasting it into a
 * website they've just found is a reasonable thing to hesitate over. The app
 * has never sent it anywhere — there is no server to send it to — but it never
 * said so, and the burden of proof is on the site, not the visitor.
 *
 * Every claim here is checkable in the source:
 *   - the data layer has exactly one request path (`src/data/fetch.ts`), and it
 *     issues GET with no body; there is no POST/PUT anywhere in the app
 *   - simulation runs in a web worker in this tab (`src/worker/sim.worker.ts`)
 *   - no analytics, telemetry, or third-party scripts of any kind
 *   - team icons come from one shared sprite sheet, so not even a species name
 *     from your team appears in a URL
 *
 * Keep this wording honest if any of that changes. "Nothing you paste is
 * uploaded" is a promise, not decoration.
 */
export function PrivacyNote({className}: {className?: string}) {
  return (
    <p className={className ? `privacy-note ${className}` : 'privacy-note'}>
      <span className="privacy-note-mark" aria-hidden="true">
        🔒
      </span>
      <span>
        <strong>Nothing you paste is uploaded.</strong> There&rsquo;s no account and no server —
        your team is validated and simulated by code running in this browser tab.
      </span>
    </p>
  );
}
