/**
 * The one place in the app that sends a request with a body.
 *
 * It exists as its own module so that fact stays checkable: the guard in
 * `test/app/privacy-note.test.ts` names this file, and any second POST site
 * fails that test. Keeping it separate from `ContactPanel` also means the
 * request body can be asserted directly in a test, rather than inferred from
 * whatever the component happened to be holding.
 *
 * The body is built here, field by field, from the argument. It does not read
 * app state, storage, or `navigator`; the browser string, when there is one,
 * was composed in the panel and shown to the reader before they ticked the box.
 */

import {
  FEEDBACK_TRAP_FIELD,
  validateFeedback,
  type FeedbackSubmission,
  type FeedbackProblem,
} from '../../shared/feedback';

export const FEEDBACK_ENDPOINT = '/api/feedback';

export type SendResult =
  | {ok: true}
  | {ok: false; reason: FeedbackProblem | 'unconfigured' | 'network' | 'server'};

/**
 * Posts a message to the site's own inbox.
 *
 * `fetchFn` is injected the way `src/data/fetch.ts` does it, so tests exercise
 * the real body-building path instead of a stub of it.
 */
export async function sendFeedback(
  sub: FeedbackSubmission & {trap?: string},
  fetchFn: typeof fetch = fetch
): Promise<SendResult> {
  const checked = validateFeedback({
    topic: sub.topic,
    message: sub.message,
    contact: sub.contact,
    browser: sub.browser,
    [FEEDBACK_TRAP_FIELD]: sub.trap ?? '',
  });
  if (!checked.ok) return {ok: false, reason: checked.problem};

  // Written out rather than spread, so a field can never reach the network by
  // being added to the object somewhere upstream.
  const body = JSON.stringify({
    topic: checked.value.topic,
    message: checked.value.message,
    contact: checked.value.contact,
    browser: checked.value.browser,
    // The honeypot travels empty from a real browser; the endpoint requires it.
    [FEEDBACK_TRAP_FIELD]: '',
  });

  let response: Response;
  try {
    response = await fetchFn(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body,
    });
  } catch {
    return {ok: false, reason: 'network'};
  }

  if (response.ok) return {ok: true};
  if (response.status === 503) return {ok: false, reason: 'unconfigured'};
  return {ok: false, reason: 'server'};
}
