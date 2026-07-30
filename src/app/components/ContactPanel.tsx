import {useState} from 'react';
import {
  FEEDBACK_LIMITS,
  FEEDBACK_TOPICS,
  FEEDBACK_TRAP_FIELD,
  problemMessage,
  topicById,
  type FeedbackTopicId,
} from '../../shared/feedback';
import {sendFeedback} from './sendFeedback';

/**
 * "Get in touch" — an anonymous inbox, with the reader's own email as a backup.
 *
 * This used to be a mailto composer only, on the grounds that the site had no
 * server to receive anything. That was honest, but it made anonymity
 * impossible: a message sent from someone's mail client carries their address
 * in the From header whether they meant to give it or not. Someone reporting
 * that the AI misplays, or that a feature is bad, shouldn't have to say who
 * they are to say so.
 *
 * So the send button posts to `/api/feedback`, a Pages Function on this site's
 * own origin, which means no third-party form service sees these. What travels
 * is the boxes below and nothing else: no address unless one is typed into the
 * contact field, and the endpoint reads no identifying headers. See
 * `functions/api/feedback.ts`.
 *
 * The mailto path stays. Someone may prefer a real thread they can keep, and it
 * is the fallback when the endpoint is down, which is the one failure mode the
 * old design could not have. On any failure the typed text stays in the box and
 * the email route is offered, rather than the message being quietly lost.
 */

export const CONTACT_ADDRESS = 'patrick-pkmn@proton.me';

/** RFC 6068: the body and subject are percent-encoded, newlines included. */
export function mailtoUrl(topicId: FeedbackTopicId, message: string, contact = ''): string {
  const topic = topicById(topicId) ?? FEEDBACK_TOPICS[0];
  const params = new URLSearchParams({subject: topic.subject});
  let body = message.trim() || topic.template;
  // Only worth carrying if they named somewhere other than the address they
  // are visibly sending from.
  if (body && contact.trim()) body += `\n\nReply to: ${contact.trim()}`;
  if (body) params.set('body', body);
  // URLSearchParams encodes spaces as "+", which mail clients render literally
  // in a subject line; mailto wants %20.
  return `mailto:${CONTACT_ADDRESS}?${params.toString().replace(/\+/g, '%20')}`;
}

/**
 * The string the "include my browser" checkbox attaches. Shown in full beside
 * the checkbox before it can be ticked: nothing is collected that the reader
 * has not read first.
 */
export function browserSummary(
  nav: {userAgent: string},
  win: {innerWidth: number; innerHeight: number}
): string {
  return `${nav.userAgent} (${win.innerWidth}x${win.innerHeight})`.slice(
    0,
    FEEDBACK_LIMITS.browser
  );
}

type Status = 'idle' | 'sending' | 'sent' | 'error';

export function ContactPanel() {
  const [topic, setTopic] = useState<FeedbackTopicId>('feedback');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [includeBrowser, setIncludeBrowser] = useState(false);
  const [trap, setTrap] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const browser =
    typeof navigator === 'undefined' || typeof window === 'undefined'
      ? ''
      : browserSummary(navigator, {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
        });

  const copyAddress = () => {
    navigator.clipboard?.writeText(CONTACT_ADDRESS).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false)
    );
  };

  const submit = async (event: {preventDefault: () => void}) => {
    event.preventDefault();
    if (status === 'sending') return;
    setStatus('sending');
    setError('');

    const result = await sendFeedback({
      topic,
      message,
      contact,
      browser: includeBrowser ? browser : '',
      trap,
    });

    if (result.ok) {
      setStatus('sent');
      return;
    }
    setStatus('error');
    setError(
      result.reason === 'network'
        ? 'That did not send. You may be offline, or the inbox may be down. Your message is still here.'
        : result.reason === 'unconfigured' || result.reason === 'server'
          ? 'The inbox did not accept that. Nothing was lost, your message is still here. The email link works instead.'
          : problemMessage(result.reason)
    );
  };

  if (status === 'sent') {
    return (
      <div className="footer-panel mono contact-panel" role="region" aria-label="Get in touch">
        <p className="contact-sent" role="status">
          <strong>Sent. Thank you for taking the time.</strong>
        </p>
        <p className="contact-note">
          {contact.trim()
            ? `I'll reply to ${contact.trim()} once I've read it.`
            : 'That went in anonymously, so there is no way for me to reply to it. If you change your mind, send another with somewhere to reach you.'}
        </p>
        <p className="contact-actions">
          <button
            type="button"
            className="contact-copy"
            onClick={() => {
              setMessage('');
              setContact('');
              setIncludeBrowser(false);
              setStatus('idle');
            }}
          >
            Write another
          </button>
        </p>
      </div>
    );
  }

  return (
    <form className="footer-panel mono contact-panel" aria-label="Get in touch" onSubmit={submit}>
      <p>
        Found a bug, disagree with a read, or just want to say something? I&rsquo;d genuinely
        like to hear it, and you don&rsquo;t have to say who you are.
      </p>

      <label className="contact-field">
        <span>What&rsquo;s it about?</span>
        <select value={topic} onChange={event => setTopic(event.target.value as FeedbackTopicId)}>
          {FEEDBACK_TOPICS.map(t => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label className="contact-field">
        <span>Your message</span>
        <textarea
          className="contact-message"
          rows={5}
          value={message}
          maxLength={FEEDBACK_LIMITS.message}
          placeholder={topicById(topic)?.template || 'Type here…'}
          onChange={event => setMessage(event.target.value)}
        />
      </label>

      <label className="contact-field">
        <span>How to reach you, if you want a reply (optional)</span>
        <input
          className="contact-reply"
          type="text"
          value={contact}
          maxLength={FEEDBACK_LIMITS.contact}
          placeholder="you@email.com, @handle, phone, or leave blank"
          onChange={event => setContact(event.target.value)}
        />
      </label>
      <p className="contact-note contact-hint">
        Anything works: email, Instagram, Twitter, Discord, a phone number. Leave it empty and
        the message arrives with no way of telling who wrote it.
      </p>

      {topic === 'bug' && (
        <label className="contact-check">
          <input
            type="checkbox"
            checked={includeBrowser}
            onChange={event => setIncludeBrowser(event.target.checked)}
          />
          <span>
            Include my browser and window size, which often explains a bug. This exact line,
            nothing more: <code className="contact-browser">{browser}</code>
          </span>
        </label>
      )}

      {/* Off-screen, and skipped by keyboard and screen readers. Anything in it
          came from something filling the form without looking at it. */}
      <div className="contact-trap" aria-hidden="true">
        <label htmlFor="contact-website">Leave this field empty</label>
        <input
          id="contact-website"
          name={FEEDBACK_TRAP_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={trap}
          onChange={event => setTrap(event.target.value)}
        />
      </div>

      <p className="contact-actions">
        <button
          type="submit"
          className="contact-send"
          disabled={status === 'sending' || !message.trim()}
        >
          {status === 'sending' ? 'Sending…' : 'Send anonymously'}
        </button>
        <a className="contact-mailto" href={mailtoUrl(topic, message, contact)}>
          Send from my own email instead
        </a>
      </p>

      <p className="contact-status" role="status" aria-live="polite">
        {status === 'error' ? error : ''}
      </p>

      <p className="contact-note">
        Sending posts your message to this site&rsquo;s own inbox, not to any form service.
        Nothing goes with it: no account, no address unless you type one above, and nothing
        about your team or your battles. Prefer email? Write to{' '}
        <button type="button" className="contact-copy" onClick={copyAddress}>
          {copied ? 'Address copied' : CONTACT_ADDRESS}
        </button>
      </p>
    </form>
  );
}
