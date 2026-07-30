/**
 * The feedback message, and the rules about it that both ends have to agree on.
 *
 * Imported by the browser (`src/app/components/sendFeedback.ts`) and by the
 * Pages Function that receives the POST (`functions/api/feedback.ts`). Keeping
 * the limits and the shape in one file is the point: if the client let someone
 * type 6000 characters and the endpoint rejected at 4000, the failure would
 * land after they hit send, with the text already gone from view.
 *
 * Nothing in here reads the DOM, the network, or any app state. What the reader
 * typed is the whole payload; see `validateFeedback` for the exact field list.
 */

/** Long enough for a real bug report, short enough to bound the request. */
export const FEEDBACK_LIMITS = {
  message: 4000,
  contact: 200,
  /** What the reader may attach about their browser, when they tick the box. */
  browser: 300,
} as const;

export const FEEDBACK_TOPICS = [
  {
    id: 'bug',
    label: 'Something is broken',
    subject: 'battle-sim: bug report',
    template:
      "What happened:\n\n\nWhat I expected instead:\n\n\nWhere (which mode/screen, and your browser):\n",
  },
  {
    id: 'feedback',
    label: 'Feedback or an idea',
    subject: 'battle-sim: feedback',
    template: '',
  },
  {
    id: 'other',
    label: 'Anything else',
    subject: 'battle-sim: hello',
    template: '',
  },
] as const;

export type FeedbackTopicId = (typeof FEEDBACK_TOPICS)[number]['id'];

export function topicById(id: string) {
  return FEEDBACK_TOPICS.find(t => t.id === id);
}

/**
 * Every field that travels. There is no id, no session, no timestamp from the
 * client and no fingerprint: an inbox that quietly correlated submissions
 * wouldn't be anonymous, whatever the label above the box said.
 */
export type FeedbackSubmission = {
  topic: FeedbackTopicId;
  message: string;
  /** Free text. An address, a handle, a phone number, or empty for no reply. */
  contact: string;
  /** Only ever set when the reader ticked the box and saw the exact string. */
  browser: string;
};

export type FeedbackProblem =
  | 'empty-message'
  | 'message-too-long'
  | 'contact-too-long'
  | 'browser-too-long'
  | 'unknown-topic'
  | 'malformed'
  | 'trap';

/**
 * The honeypot field's name. Rendered off-screen and never shown to a reader,
 * so anything in it came from something filling the form blind.
 */
export const FEEDBACK_TRAP_FIELD = 'website';

export type FeedbackValidation =
  | {ok: true; value: FeedbackSubmission}
  | {ok: false; problem: FeedbackProblem};

/**
 * Parses whatever arrived into a submission, or says why it can't.
 *
 * Runs on both ends against the same input shape. The endpoint can't trust the
 * client to have run it, and the client runs it to keep the reader from losing
 * a long message to a rejection it could have caught before sending.
 */
export function validateFeedback(input: unknown): FeedbackValidation {
  if (typeof input !== 'object' || input === null) return {ok: false, problem: 'malformed'};
  const raw = input as Record<string, unknown>;

  const str = (key: string): string | null => {
    const v = raw[key];
    if (v === undefined || v === null) return '';
    return typeof v === 'string' ? v : null;
  };

  const trap = str(FEEDBACK_TRAP_FIELD);
  if (trap === null || trap.trim() !== '') return {ok: false, problem: 'trap'};

  const topic = str('topic');
  if (topic === null || !topicById(topic)) return {ok: false, problem: 'unknown-topic'};

  const message = str('message');
  const contact = str('contact');
  const browser = str('browser');
  if (message === null || contact === null || browser === null) {
    return {ok: false, problem: 'malformed'};
  }

  const trimmed = message.trim();
  if (!trimmed) return {ok: false, problem: 'empty-message'};
  if (trimmed.length > FEEDBACK_LIMITS.message) return {ok: false, problem: 'message-too-long'};
  if (contact.trim().length > FEEDBACK_LIMITS.contact) {
    return {ok: false, problem: 'contact-too-long'};
  }
  if (browser.trim().length > FEEDBACK_LIMITS.browser) {
    return {ok: false, problem: 'browser-too-long'};
  }

  return {
    ok: true,
    value: {
      topic: topic as FeedbackTopicId,
      message: trimmed,
      contact: contact.trim(),
      browser: browser.trim(),
    },
  };
}

/** Human-readable reason, shown in the panel when a send is refused. */
export function problemMessage(problem: FeedbackProblem): string {
  switch (problem) {
    case 'empty-message':
      return 'Write a message first.';
    case 'message-too-long':
      return `That is longer than ${FEEDBACK_LIMITS.message} characters. Trim it, or send it by email instead.`;
    case 'contact-too-long':
      return 'That contact detail is too long.';
    case 'browser-too-long':
    case 'malformed':
    case 'trap':
    case 'unknown-topic':
      return 'Something about that message could not be sent. Email works instead.';
  }
}

/**
 * The text that lands in the inbox.
 *
 * Built only from the validated submission. "no reply requested" is written out
 * rather than left blank so an anonymous message reads as deliberate rather
 * than as a field that failed to arrive.
 */
export function formatFeedback(sub: FeedbackSubmission): string {
  const topic = topicById(sub.topic);
  const lines = [
    `**${topic ? topic.label : sub.topic}**`,
    '',
    sub.message,
    '',
    sub.contact ? `Reply to: ${sub.contact}` : 'Anonymous, no reply requested.',
  ];
  if (sub.browser) lines.push(`Browser: ${sub.browser}`);
  return lines.join('\n');
}

/**
 * Discord caps a webhook message at 2000 characters and Slack far higher; over
 * the cap the whole POST is rejected. Splitting is better than truncating: a
 * carefully written bug report shouldn't lose its second half to a limit the
 * person who wrote it never saw.
 */
export function chunkForWebhook(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let rest = text;
  // Leave room for the "(1/3)" marker appended below.
  const room = Math.max(1, limit - 12);
  while (rest.length > room) {
    const window = rest.slice(0, room);
    const breakAt = window.lastIndexOf('\n');
    const cut = breakAt > room / 2 ? breakAt : room;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks.map((chunk, i) => `${chunk}\n(${i + 1}/${chunks.length})`);
}

/**
 * Discord wants `content`, Slack wants `text`, and each ignores a body it
 * doesn't recognise by rejecting it. The host is the only thing that
 * distinguishes them, and the URL is a server-side secret, so this decision
 * never happens in the browser.
 */
export function webhookRequest(webhookUrl: string): {
  limit: number;
  body: (chunk: string) => string;
} {
  let host = '';
  try {
    host = new URL(webhookUrl).host;
  } catch {
    host = '';
  }
  const slack = host.endsWith('slack.com');
  return {
    limit: slack ? 3000 : 1900,
    body: (chunk: string) => JSON.stringify(slack ? {text: chunk} : {content: chunk}),
  };
}

/** Convenience for the endpoint: format, then split to the platform's cap. */
export function webhookChunks(webhookUrl: string, sub: FeedbackSubmission): string[] {
  const {limit} = webhookRequest(webhookUrl);
  return chunkForWebhook(formatFeedback(sub), limit);
}
