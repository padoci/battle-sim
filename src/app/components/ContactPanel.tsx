import {useState} from 'react';

/**
 * "Get in touch" — a mailto composer, not a form.
 *
 * The site has no server, and the paste boxes now promise as much. A hosted
 * form endpoint would have to POST somewhere, which would make that promise
 * false and fail the guard in `privacy-note.test.ts`. So this composes a
 * message and hands it to the reader's own email app: they see the address,
 * the subject and the body before anything is sent, and they send it
 * themselves, from their own account. Nothing leaves the page.
 *
 * The tradeoff is that a reader with no mail client configured gets nothing
 * when they click — hence the address is always visible and copyable, and
 * whatever they typed stays in the box afterwards.
 */

export const CONTACT_ADDRESS = 'patrick-pkmn@proton.me';

const TOPICS = [
  {
    id: 'bug',
    label: 'Something is broken',
    subject: 'battle-sim: bug report',
    template:
      "What happened:\n\n\nWhat I expected instead:\n\n\nWhere (which mode/screen, and your browser):\n\n",
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

type TopicId = (typeof TOPICS)[number]['id'];

/** RFC 6068: the body and subject are percent-encoded, newlines included. */
export function mailtoUrl(topicId: TopicId, message: string): string {
  const topic = TOPICS.find(t => t.id === topicId) ?? TOPICS[0];
  const params = new URLSearchParams({subject: topic.subject});
  const body = message.trim() || topic.template;
  if (body) params.set('body', body);
  // URLSearchParams encodes spaces as "+", which mail clients render literally
  // in a subject line; mailto wants %20.
  return `mailto:${CONTACT_ADDRESS}?${params.toString().replace(/\+/g, '%20')}`;
}

export function ContactPanel() {
  const [topic, setTopic] = useState<TopicId>('feedback');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);

  const copyAddress = () => {
    navigator.clipboard?.writeText(CONTACT_ADDRESS).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false)
    );
  };

  return (
    <div className="footer-panel mono contact-panel" role="region" aria-label="Get in touch">
      <p>
        Found a bug, disagree with a read, or just want to say something? I&rsquo;d genuinely
        like to hear it.
      </p>

      <label className="contact-field">
        <span>What&rsquo;s it about?</span>
        <select value={topic} onChange={event => setTopic(event.target.value as TopicId)}>
          {TOPICS.map(t => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label className="contact-field">
        <span>Your message (optional &mdash; you can also just write it in your email app)</span>
        <textarea
          className="contact-message"
          rows={5}
          value={message}
          placeholder="Type here, or leave it blank and write in your email app…"
          onChange={event => setMessage(event.target.value)}
        />
      </label>

      <p className="contact-actions">
        <a className="contact-send" href={mailtoUrl(topic, message)}>
          Open this in your email app
        </a>
        <button type="button" className="contact-copy" onClick={copyAddress}>
          {copied ? 'Address copied' : `Copy ${CONTACT_ADDRESS}`}
        </button>
      </p>

      <p className="contact-note">
        This opens your own email app with the message ready to send &mdash; the site
        doesn&rsquo;t send anything itself, and nothing you type here leaves the page until you
        hit send yourself. If the button does nothing, your browser has no email app set up:
        copy the address above instead. Whatever you&rsquo;ve typed stays in the box.
      </p>
    </div>
  );
}
