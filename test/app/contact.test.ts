// @vitest-environment jsdom
import {createElement} from 'react';
import {cleanup, render} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {CONTACT_ADDRESS, ContactPanel, mailtoUrl} from '../../src/app/components/ContactPanel';

afterEach(cleanup);

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
    for (const s of subjects) expect(s).toMatch(/^battle-sim: /);
  });

  it('encodes spaces as %20 rather than +', () => {
    // URLSearchParams defaults to "+", which mail clients show literally in a
    // subject line ("battle-sim:+bug+report").
    const url = mailtoUrl('bug', 'two words');
    expect(url).not.toContain('+');
    expect(url).toContain('%20');
  });

  it('carries the typed message through as the body', () => {
    const params = new URLSearchParams(new URL(mailtoUrl('feedback', 'the AI misplays Tera')).search);
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
});

describe('ContactPanel', () => {
  it('always shows the address, so a missing mail client is not a dead end', () => {
    const {container} = render(createElement(ContactPanel));
    expect(container.textContent).toContain(CONTACT_ADDRESS);
  });

  it('offers a real link rather than a click-only button', () => {
    // An anchor keeps the browser's own affordances — open in a new window,
    // copy the address — for people whose mail app isn't the default handler.
    const {container} = render(createElement(ContactPanel));
    const link = container.querySelector('a.contact-send') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toMatch(/^mailto:/);
  });

  it('says plainly that the site itself sends nothing', () => {
    // The paste boxes promise no upload; this panel must not read as a form
    // that quietly posts somewhere.
    const {container} = render(createElement(ContactPanel));
    expect(container.textContent).toMatch(/site doesn’t send anything itself/i);
  });

  it('labels both of its inputs', () => {
    const {container} = render(createElement(ContactPanel));
    for (const field of container.querySelectorAll('select, textarea')) {
      expect(field.closest('label')).toBeTruthy();
    }
  });
});
