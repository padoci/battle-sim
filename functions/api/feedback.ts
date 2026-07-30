/**
 * The anonymous inbox. A Cloudflare Pages Function, so it is served from the
 * site's own origin and there is no third party between the reader and me.
 *
 * What it does NOT do is the part worth reading. It never touches
 * `CF-Connecting-IP`, `X-Forwarded-For`, `request.cf`, or the User-Agent
 * header; it stores nothing; and it forwards exactly the fields the reader
 * typed, as validated by `validateFeedback`. A message with an empty contact
 * field arrives with nothing attached that could identify who sent it, which
 * is the promise the panel makes. `test/app/feedback-endpoint.test.ts` holds
 * that line: it fails if this file starts reading identifying headers.
 *
 * Setup: the Pages project needs one secret, FEEDBACK_WEBHOOK_URL, pointing at
 * a Discord or Slack incoming webhook. Without it the endpoint answers 503 and
 * the panel falls back to the mailto path rather than swallowing the message.
 * See README, "Feedback inbox".
 */

import {
  validateFeedback,
  webhookChunks,
  webhookRequest,
  type FeedbackProblem,
} from '../../src/shared/feedback';

type Env = {FEEDBACK_WEBHOOK_URL?: string};

type FunctionContext = {
  request: Request;
  env: Env;
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Nothing here is worth caching, and a cached 503 would outlive the fix.
      'cache-control': 'no-store',
    },
  });

/** A rejection the caller can act on, without telling a prober which is which. */
const problemStatus = (problem: FeedbackProblem): number => {
  // The honeypot is answered 204, not 400: a bot that learns it was caught
  // learns which field to leave alone next time.
  if (problem === 'trap') return 204;
  return 400;
};

/**
 * One handler for every method rather than an `onRequestPost` beside an
 * `onRequest`: exporting both leaves which one wins up to the router, and the
 * cost of guessing wrong is that real messages get 405.
 */
export const onRequest = async ({request, env}: FunctionContext): Promise<Response> => {
  if (request.method !== 'POST') {
    return json(405, {error: 'method not allowed'});
  }

  // Same-origin only. The form lives on this site; a POST carrying someone
  // else's Origin is a form embedded elsewhere, which is not something this
  // inbox needs to serve.
  const origin = request.headers.get('origin');
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = '';
    }
    if (originHost !== new URL(request.url).host) {
      return json(403, {error: 'cross-origin'});
    }
  }

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json(415, {error: 'expected json'});
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json(400, {error: 'malformed'});
  }

  const parsed = validateFeedback(payload);
  if (!parsed.ok) {
    const status = problemStatus(parsed.problem);
    return status === 204 ? new Response(null, {status: 204}) : json(status, {error: parsed.problem});
  }

  const webhook = env.FEEDBACK_WEBHOOK_URL;
  if (!webhook) {
    // Deliberately loud. A silent 200 here would drop real messages on the
    // floor and tell the sender they had been received.
    return json(503, {error: 'inbox-unconfigured'});
  }

  const {body} = webhookRequest(webhook);
  const chunks = webhookChunks(webhook, parsed.value);

  for (const chunk of chunks) {
    const relayed = await fetch(webhook, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: body(chunk),
    });
    if (!relayed.ok) {
      return json(502, {error: 'relay-failed'});
    }
  }

  return json(200, {ok: true});
};
