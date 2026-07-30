// @vitest-environment jsdom
import {createElement} from 'react';
import {cleanup, fireEvent, render, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  CONTACT_ADDRESS,
  ContactPanel,
  browserSummary,
  mailtoUrl,
} from '../../src/app/components/ContactPanel';
import {FEEDBACK_ENDPOINT, sendFeedback} from '../../src/app/components/sendFeedback';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sentBody = (fetchFn: {mock: {calls: unknown[][]}}, call = 0) =>
  JSON.parse(String((fetchFn.mock.calls[call] as [string, RequestInit])[1].body));

describe('mailtoUrl', () => {
  it('addresses the message to the contact address', () => {
    expect(mailtoUrl('feedback', 'hello')).toMatch(new RegExp(`^mailto:${CONTACT_ADDRESS}\\?`));
  });

  it('gives each topic its own subject, so mail can be filtered', () => {
    const subjects = (['bug', 'feedback', 'other'] as const).map(id => {
      const url = new URL(mailtoUrl(id, 'x'));
      return new URLSearchParams(url.search).get('subject');
    });
    expect(new Set(subjects).size).toBe(3);
    for (const s of subjects) expect(s).toMatch(/^Team Preview: /);
  });

  it('encodes spaces as %20 rather than +', () => {
    // URLSearchParams defaults to "+", which mail clients show literally in a
    // subject line ("Team+Preview:+bug+report").
    const url = mailtoUrl('bug', 'two words');
    expect(url).not.toContain('+');
    expect(url).toContain('%20');
  });

  it('carries the typed message through as the body', () => {
    const params = new URLSearchParams(
      new URL(mailtoUrl('feedback', 'the AI misplays Tera')).search
    );
    expect(params.get('body')).toBe('the AI misplays Tera');
  });

  it('survives characters that would otherwise break the URL', () => {
    const nasty = 'crash on "Great Tusk" & 100% HP — turn #3?\nsecond line';
    const params = new URLSearchParams(new URL(mailtoUrl('bug', nasty)).search);
    expect(params.get('body')).toBe(nasty);
  });

  it('falls back to the topic template when nothing was typed', () => {
    const params = new URLSearchParams(new URL(mailtoUrl('bug', '   ')).search);
    expect(params.get('body')).toMatch(/What happened/);
  });

  it('sends no body at all for a blank free-form message', () => {
    // Nothing useful to prefill; an empty body= is noise in the mail client.
    const params = new URLSearchParams(new URL(mailtoUrl('other', '')).search);
    expect(params.get('body')).toBeNull();
  });

  it('carries an alternative contact detail into the mail body', () => {
    // Someone mailing from one address may want replies at a handle instead.
    const params = new URLSearchParams(new URL(mailtoUrl('feedback', 'hi', '@patrick')).search);
    expect(params.get('body')).toBe('hi\n\nReply to: @patrick');
  });
});

describe('sendFeedback', () => {
  const ok = () => new Response(JSON.stringify({ok: true}), {status: 200});

  it('posts to the site’s own endpoint, not a third party', async () => {
    const fetchFn = vi.fn(async () => ok());
    await sendFeedback({topic: 'feedback', message: 'hi', contact: '', browser: ''}, fetchFn);
    const [url] = fetchFn.mock.calls[0] as unknown as [string];
    expect(url).toBe(FEEDBACK_ENDPOINT);
    // Relative, so it can only ever reach the origin serving the page.
    expect(url.startsWith('/')).toBe(true);
  });

  it('sends exactly the declared fields and nothing else', async () => {
    // The guard that matters: if a later change threads app state into this
    // call, the key list changes and this fails.
    const fetchFn = vi.fn(async () => ok());
    await sendFeedback(
      {
        topic: 'bug',
        message: 'it crashed',
        contact: '@patrick',
        browser: 'Firefox (800x600)',
        team: 'Great Tusk @ Leftovers',
      } as never,
      fetchFn
    );
    const body = sentBody(fetchFn);
    // Spelled out rather than built from the constants, so this pins the wire
    // format itself: renaming a field is a change both ends have to make.
    expect(Object.keys(body).sort()).toEqual([
      'browser',
      'confirm-empty',
      'contact',
      'message',
      'topic',
    ]);
    expect(JSON.stringify(body)).not.toMatch(/Great Tusk/);
  });

  it('sends an empty contact field rather than inventing one', async () => {
    const fetchFn = vi.fn(async () => ok());
    await sendFeedback({topic: 'feedback', message: 'hi', contact: '', browser: ''}, fetchFn);
    expect(sentBody(fetchFn).contact).toBe('');
  });

  it('does not send at all when there is nothing to say', async () => {
    const fetchFn = vi.fn(async () => ok());
    const result = await sendFeedback(
      {topic: 'feedback', message: '  ', contact: '', browser: ''},
      fetchFn
    );
    expect(result).toEqual({ok: false, reason: 'empty-message'});
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('tells the caller apart the ways a send can fail', async () => {
    const status = (code: number) => vi.fn(async () => new Response(null, {status: code}));
    const sub = {topic: 'feedback', message: 'hi', contact: '', browser: ''} as const;
    expect(await sendFeedback(sub, status(503))).toEqual({ok: false, reason: 'unconfigured'});
    expect(await sendFeedback(sub, status(502))).toEqual({ok: false, reason: 'server'});
    const dead = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await sendFeedback(sub, dead as never)).toEqual({ok: false, reason: 'network'});
  });
});

describe('browserSummary', () => {
  it('is the user agent and the window size, and nothing else', () => {
    expect(browserSummary({userAgent: 'Firefox/1'}, {innerWidth: 800, innerHeight: 600})).toBe(
      'Firefox/1 (800x600)'
    );
  });
});

describe('ContactPanel', () => {
  const okFetch = () =>
    vi.fn(async () => new Response(JSON.stringify({ok: true}), {status: 200}));
  const form = (c: HTMLElement) => c.querySelector('form') as HTMLFormElement;
  const messageBox = (c: HTMLElement) => c.querySelector('.contact-message') as HTMLTextAreaElement;
  const replyBox = (c: HTMLElement) => c.querySelector('.contact-reply') as HTMLInputElement;

  it('lets someone send without giving any way to reach them', async () => {
    // The reason this panel exists. Nothing about the contact field may be
    // required, and a send with it empty must go through.
    const fetchFn = okFetch();
    vi.stubGlobal('fetch', fetchFn);
    const {container} = render(createElement(ContactPanel));

    expect(replyBox(container).required).toBe(false);
    fireEvent.change(messageBox(container), {target: {value: 'the AI misplays Tera'}});
    fireEvent.submit(form(container));

    await waitFor(() => expect(container.textContent).toMatch(/Sent/i));
    expect(sentBody(fetchFn).contact).toBe('');
    // And it says so, rather than promising a reply that cannot come.
    expect(container.textContent).toMatch(/no way for me to reply/i);
  });

  it('takes a handle or a phone number, not just an email address', () => {
    // A type="email" input would refuse "@patrick" outright.
    const {container} = render(createElement(ContactPanel));
    expect(replyBox(container).type).toBe('text');
  });

  it('sends the contact detail when one is given', async () => {
    const fetchFn = okFetch();
    vi.stubGlobal('fetch', fetchFn);
    const {container} = render(createElement(ContactPanel));

    fireEvent.change(messageBox(container), {target: {value: 'hello'}});
    fireEvent.change(replyBox(container), {target: {value: '@patrick'}});
    fireEvent.submit(form(container));

    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(sentBody(fetchFn).contact).toBe('@patrick');
  });

  it('will not send an empty message', () => {
    const {container} = render(createElement(ContactPanel));
    const send = container.querySelector('.contact-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(messageBox(container), {target: {value: 'something'}});
    expect(send.disabled).toBe(false);
  });

  it('keeps the message when sending fails, and offers email instead', async () => {
    // The old mailto-only panel could not lose a message. This one can, so a
    // failed send must not clear the box.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, {status: 503}))
    );
    const {container} = render(createElement(ContactPanel));

    fireEvent.change(messageBox(container), {target: {value: 'a long report'}});
    fireEvent.submit(form(container));

    await waitFor(() => expect(container.textContent).toMatch(/did not accept/i));
    expect(messageBox(container).value).toBe('a long report');
    const fallback = container.querySelector('.contact-mailto') as HTMLAnchorElement;
    expect(fallback.getAttribute('href')).toMatch(/^mailto:/);
  });

  it('always shows the address, so a failed send is never a dead end', () => {
    const {container} = render(createElement(ContactPanel));
    expect(container.textContent).toContain(CONTACT_ADDRESS);
  });

  it('offers the mail route as a real link rather than a click-only button', () => {
    // An anchor keeps the browser's own affordances for people whose mail app
    // is not the default handler.
    const {container} = render(createElement(ContactPanel));
    const link = container.querySelector('a.contact-mailto') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toMatch(/^mailto:/);
  });

  it('says what the send does and does not carry', () => {
    // The panel must not read as a form that quietly posts more than it shows.
    const {container} = render(createElement(ContactPanel));
    expect(container.textContent).toMatch(/no address unless you type one/i);
    expect(container.textContent).toMatch(/nothing about your team/i);
  });

  it('offers browser details only for a bug report', () => {
    const {container} = render(createElement(ContactPanel));
    expect(container.querySelector('.contact-check')).toBeNull();
    fireEvent.change(container.querySelector('select') as HTMLSelectElement, {
      target: {value: 'bug'},
    });
    expect(container.querySelector('.contact-check')).toBeTruthy();
  });

  it('attaches nothing about the browser unless the box is ticked', async () => {
    const fetchFn = okFetch();
    vi.stubGlobal('fetch', fetchFn);
    const {container} = render(createElement(ContactPanel));
    fireEvent.change(container.querySelector('select') as HTMLSelectElement, {
      target: {value: 'bug'},
    });

    const check = container.querySelector('.contact-check input') as HTMLInputElement;
    expect(check.checked).toBe(false);
    fireEvent.change(messageBox(container), {target: {value: 'it crashed'}});
    fireEvent.submit(form(container));

    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(sentBody(fetchFn).browser).toBe('');
  });

  it('shows the exact line it would attach before the box is ticked', async () => {
    const fetchFn = okFetch();
    vi.stubGlobal('fetch', fetchFn);
    const {container} = render(createElement(ContactPanel));
    fireEvent.change(container.querySelector('select') as HTMLSelectElement, {
      target: {value: 'bug'},
    });

    const expected = browserSummary(navigator, {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    });
    expect(container.querySelector('.contact-browser')?.textContent).toBe(expected);

    fireEvent.click(container.querySelector('.contact-check input') as HTMLInputElement);
    fireEvent.change(messageBox(container), {target: {value: 'it crashed'}});
    fireEvent.submit(form(container));

    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    // What was sent is what was on screen, character for character.
    expect(sentBody(fetchFn).browser).toBe(expected);
  });

  it('hides the honeypot from readers and assistive tech', () => {
    const {container} = render(createElement(ContactPanel));
    const trap = container.querySelector('.contact-trap') as HTMLElement;
    expect(trap.getAttribute('aria-hidden')).toBe('true');
    expect((trap.querySelector('input') as HTMLInputElement).tabIndex).toBe(-1);
  });

  it('labels every input a reader can see', () => {
    const {container} = render(createElement(ContactPanel));
    for (const field of container.querySelectorAll('select, textarea, .contact-reply')) {
      expect(field.closest('label')).toBeTruthy();
    }
  });
});
