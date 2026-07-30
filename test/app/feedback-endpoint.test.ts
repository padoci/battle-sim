import {readFileSync} from 'node:fs';
import {describe, expect, it, vi} from 'vitest';
import {
  FEEDBACK_LIMITS,
  FEEDBACK_TRAP_FIELD,
  chunkForWebhook,
  formatFeedback,
  validateFeedback,
  webhookChunks,
  webhookRequest,
  type FeedbackSubmission,
} from '../../src/shared/feedback';
import {onRequest} from '../../functions/api/feedback';

const submission = (over: Partial<FeedbackSubmission> = {}): FeedbackSubmission => ({
  topic: 'feedback',
  message: 'the AI misplays Tera',
  contact: '',
  browser: '',
  ...over,
});

const post = (body: unknown, init: RequestInit = {}) =>
  new Request('https://battle-sim-eo1.pages.dev/api/feedback', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });

const payload = (over: Record<string, unknown> = {}) => ({
  topic: 'feedback',
  message: 'the AI misplays Tera',
  contact: '',
  browser: '',
  [FEEDBACK_TRAP_FIELD]: '',
  ...over,
});

describe('validateFeedback', () => {
  it('accepts a message with no contact detail at all', () => {
    // The whole point of the inbox: anonymous is a valid, complete submission,
    // not a form with a field missing.
    const result = validateFeedback(payload());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.contact).toBe('');
  });

  it('takes any shape of contact detail, not just an email address', () => {
    // A typed email input would reject three of these four.
    for (const contact of ['me@example.com', '@patrick', '+44 7700 900000', 'patrick#1234']) {
      const result = validateFeedback(payload({contact}));
      expect(result.ok, contact).toBe(true);
      if (result.ok) expect(result.value.contact).toBe(contact);
    }
  });

  it('refuses an empty or whitespace-only message', () => {
    for (const message of ['', '   \n  ']) {
      const result = validateFeedback(payload({message}));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problem).toBe('empty-message');
    }
  });

  it('bounds every field, so one request cannot carry an essay', () => {
    const long = (n: number) => 'x'.repeat(n + 1);
    expect(validateFeedback(payload({message: long(FEEDBACK_LIMITS.message)}))).toMatchObject({
      problem: 'message-too-long',
    });
    expect(validateFeedback(payload({contact: long(FEEDBACK_LIMITS.contact)}))).toMatchObject({
      problem: 'contact-too-long',
    });
    expect(validateFeedback(payload({browser: long(FEEDBACK_LIMITS.browser)}))).toMatchObject({
      problem: 'browser-too-long',
    });
  });

  it('catches a filled honeypot', () => {
    expect(validateFeedback(payload({[FEEDBACK_TRAP_FIELD]: 'http://spam'}))).toMatchObject({
      problem: 'trap',
    });
  });

  it('rejects a topic it does not know', () => {
    expect(validateFeedback(payload({topic: 'sql'}))).toMatchObject({problem: 'unknown-topic'});
  });

  it('rejects non-string fields rather than coercing them', () => {
    expect(validateFeedback(payload({message: {toString: 'nope'}}))).toMatchObject({
      problem: 'malformed',
    });
    expect(validateFeedback('a string')).toMatchObject({problem: 'malformed'});
    expect(validateFeedback(null)).toMatchObject({problem: 'malformed'});
  });

  it('keeps only the declared fields, dropping anything smuggled alongside', () => {
    const result = validateFeedback(payload({team: 'Great Tusk @ Leftovers', ip: '1.2.3.4'}));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value).sort()).toEqual(['browser', 'contact', 'message', 'topic']);
    }
  });
});

describe('formatFeedback', () => {
  it('says outright when a message is anonymous', () => {
    // Otherwise a blank contact line reads like a field that failed to arrive.
    expect(formatFeedback(submission())).toMatch(/Anonymous, no reply requested/);
  });

  it('carries the contact detail through verbatim', () => {
    expect(formatFeedback(submission({contact: '@patrick'}))).toContain('Reply to: @patrick');
  });

  it('omits the browser line unless one was attached', () => {
    expect(formatFeedback(submission())).not.toMatch(/Browser:/);
    expect(formatFeedback(submission({browser: 'Firefox (800x600)'}))).toMatch(/Browser: Firefox/);
  });
});

describe('chunkForWebhook', () => {
  it('leaves a short message in one piece and unmarked', () => {
    expect(chunkForWebhook('short', 100)).toEqual(['short']);
  });

  it('splits rather than truncates, so no message is silently halved', () => {
    const text = Array.from({length: 40}, (_, i) => `line ${i} of the bug report`).join('\n');
    const chunks = chunkForWebhook(text, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200);
    // Every word survives somewhere, in order.
    const rejoined = chunks.map(c => c.replace(/\n\(\d+\/\d+\)$/, '')).join('\n');
    for (let i = 0; i < 40; i++) expect(rejoined).toContain(`line ${i} of the bug report`);
  });

  it('splits an unbroken wall of text too', () => {
    const chunks = chunkForWebhook('x'.repeat(5000), 200);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200);
    expect(chunks.join('').replace(/\(\d+\/\d+\)/g, '').replace(/\n/g, '')).toHaveLength(5000);
  });

  it('keeps the longest allowed message inside Discord’s cap once formatted', () => {
    // The client lets someone type FEEDBACK_LIMITS.message characters; if the
    // formatted result blew the cap, the webhook would 400 and the message
    // would be lost after they were told it sent.
    const url = 'https://discord.com/api/webhooks/1/abc';
    const chunks = webhookChunks(url, submission({message: 'y'.repeat(FEEDBACK_LIMITS.message)}));
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(2000);
  });
});

describe('webhookRequest', () => {
  it('speaks Slack’s shape to Slack and Discord’s to everything else', () => {
    expect(JSON.parse(webhookRequest('https://hooks.slack.com/services/x').body('hi'))).toEqual({
      text: 'hi',
    });
    expect(JSON.parse(webhookRequest('https://discord.com/api/webhooks/1/x').body('hi'))).toEqual({
      content: 'hi',
    });
  });

  it('falls back to the tighter limit for an unparseable URL', () => {
    expect(webhookRequest('not a url').limit).toBe(1900);
  });
});

const WEBHOOK = 'https://discord.com/api/webhooks/1/secret';

describe('the /api/feedback endpoint', () => {
  const relay = (ok = true) => vi.fn(async () => new Response(null, {status: ok ? 204 : 500}));

  it('relays a valid message and reports success', async () => {
    const fetchFn = relay();
    vi.stubGlobal('fetch', fetchFn);
    const res = await onRequest({request: post(payload()), env: {FEEDBACK_WEBHOOK_URL: WEBHOOK}});
    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('forwards nothing but what was typed', async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(String(init.body)).content as string;
      // The team, and anything else riding along in the request, must not
      // reach the inbox even though it reached the endpoint.
      expect(sent).not.toMatch(/Great Tusk/);
      expect(sent).toContain('the AI misplays Tera');
      return new Response(null, {status: 204});
    });
    vi.stubGlobal('fetch', fetchFn);
    const res = await onRequest({
      request: post(payload({team: 'Great Tusk @ Leftovers'})),
      env: {FEEDBACK_WEBHOOK_URL: WEBHOOK},
    });
    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('never asks the request who sent it', async () => {
    // The headers a proxy would use to identify someone are present on every
    // real request; the endpoint must not read them. Reading one here throws.
    const request = post(payload());
    const identifying = ['cf-connecting-ip', 'x-forwarded-for', 'x-real-ip', 'user-agent'];
    const realGet = request.headers.get.bind(request.headers);
    request.headers.get = (name: string) => {
      if (identifying.includes(name.toLowerCase())) {
        throw new Error(`endpoint read an identifying header: ${name}`);
      }
      return realGet(name);
    };
    vi.stubGlobal('fetch', relay());
    const res = await onRequest({request, env: {FEEDBACK_WEBHOOK_URL: WEBHOOK}});
    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it('answers 503 when no inbox is configured, rather than eating the message', async () => {
    // A silent 200 would tell the sender it arrived when nothing received it.
    const fetchFn = relay();
    vi.stubGlobal('fetch', fetchFn);
    const res = await onRequest({request: post(payload()), env: {}});
    expect(res.status).toBe(503);
    expect(fetchFn).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('reports a webhook failure rather than claiming success', async () => {
    vi.stubGlobal('fetch', relay(false));
    const res = await onRequest({request: post(payload()), env: {FEEDBACK_WEBHOOK_URL: WEBHOOK}});
    expect(res.status).toBe(502);
    vi.unstubAllGlobals();
  });

  it('turns away a form embedded on another site', async () => {
    const res = await onRequest({
      request: post(payload(), {headers: {'content-type': 'application/json', origin: 'https://evil.example'}}),
      env: {FEEDBACK_WEBHOOK_URL: WEBHOOK},
    });
    expect(res.status).toBe(403);
  });

  it('accepts a same-origin request that declares its origin', async () => {
    vi.stubGlobal('fetch', relay());
    const res = await onRequest({
      request: post(payload(), {
        headers: {
          'content-type': 'application/json',
          origin: 'https://battle-sim-eo1.pages.dev',
        },
      }),
      env: {FEEDBACK_WEBHOOK_URL: WEBHOOK},
    });
    expect(res.status).toBe(200);
    vi.unstubAllGlobals();
  });

  it('rejects anything that is not a POST of JSON', async () => {
    const get = new Request('https://battle-sim-eo1.pages.dev/api/feedback');
    expect((await onRequest({request: get, env: {}})).status).toBe(405);

    const form = post(payload(), {headers: {'content-type': 'text/plain'}});
    expect((await onRequest({request: form, env: {}})).status).toBe(415);

    const broken = post('{not json', {headers: {'content-type': 'application/json'}});
    expect((await onRequest({request: broken, env: {}})).status).toBe(400);
  });

  it('answers a caught bot with silence, not with a hint', async () => {
    // A 400 saying "trap" tells whoever is probing which field to leave alone.
    const fetchFn = relay();
    vi.stubGlobal('fetch', fetchFn);
    const res = await onRequest({
      request: post(payload({[FEEDBACK_TRAP_FIELD]: 'http://spam'})),
      env: {FEEDBACK_WEBHOOK_URL: WEBHOOK},
    });
    expect(res.status).toBe(204);
    expect(fetchFn).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('what the endpoint is allowed to touch', () => {
  // A source scan, like the guards in privacy-note.test.ts: the point is to
  // catch the change at review time. The runtime test above covers today's
  // code path; this covers a path someone adds later.
  //
  // Comments are stripped first, because the file's own header explains which
  // headers it refuses to read and would otherwise fail its own scan. Only
  // whole-line `//` comments go, so a trailing comment beside real code is
  // still scanned rather than being a place to hide a header read.
  const source = readFileSync('functions/api/feedback.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('reads no identifying header and no Cloudflare request metadata', () => {
    for (const forbidden of [
      /cf-connecting-ip/i,
      /x-forwarded-for/i,
      /x-real-ip/i,
      /user-agent/i,
      /request\.cf/,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  it('stores nothing', () => {
    // No KV, D1, R2 or Durable Object binding: nothing to accumulate, nothing
    // to subpoena, nothing to leak.
    for (const store of [/\.put\(/, /\.prepare\(/, /D1/, /KV/, /DurableObject/]) {
      expect(source).not.toMatch(store);
    }
  });
});
