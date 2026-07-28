// @vitest-environment jsdom
import {createElement} from 'react';
import {cleanup, render} from '@testing-library/react';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {PrivacyNote} from '../../src/app/components/PrivacyNote';

afterEach(cleanup);

describe('PrivacyNote', () => {
  it('states the promise plainly', () => {
    const {container} = render(createElement(PrivacyNote));
    const text = container.textContent ?? '';
    expect(text).toMatch(/nothing you paste is uploaded/i);
    expect(text).toMatch(/no server/i);
  });

  it('is decoration-free for screen readers apart from the wording', () => {
    // The padlock is ornamental; the sentence carries the meaning.
    const {container} = render(createElement(PrivacyNote));
    expect(container.querySelector('.privacy-note-mark')?.getAttribute('aria-hidden')).toBe('true');
  });
});

/**
 * The note above makes a promise about the whole app, so it can't be checked by
 * rendering a component. These guard the claim at the source level: if someone
 * adds a POST, a beacon, or an analytics script, this fails and whoever did it
 * has to come back and decide whether the wording is still true.
 *
 * Deliberately a text scan rather than a runtime assertion — the point is to
 * catch the change at review time, not to prove a negative at runtime.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe('the claims the privacy note makes', () => {
  const files = sourceFiles('src');
  const read = (f: string) => ({file: f, text: readFileSync(f, 'utf8')});
  const sources = files.map(read);

  it('sends no request that can carry a body', () => {
    const offenders = sources
      .filter(s => /method:\s*['"`](POST|PUT|PATCH|DELETE)/i.test(s.text) || /sendBeacon/.test(s.text))
      .map(s => s.file);
    expect(offenders).toEqual([]);
  });

  it('loads no analytics, telemetry or third-party tracking script', () => {
    const offenders = sources
      .filter(s => /\b(gtag|googletagmanager|plausible|posthog|mixpanel|segment\.com|fathom|umami|clarity\.ms)\b/i.test(s.text))
      .map(s => s.file);
    expect(offenders).toEqual([]);
  });

  it('writes no cookies', () => {
    const offenders = sources.filter(s => /document\.cookie/.test(s.text)).map(s => s.file);
    expect(offenders).toEqual([]);
  });

  it('keeps request-issuing confined to the two places the note describes', () => {
    // Reference data goes through `src/data/fetch.ts`, which calls an injected
    // `fetchFn` rather than the global — so the only direct `fetch(` in the
    // app is the TCG art lookup, and that sends a species name from the draft
    // pool, never anything from a user's team. A third call site means the
    // "only things fetched" paragraph needs rewriting.
    const direct = sources
      .filter(s => /\bfetch\(/.test(s.text))
      .map(s => s.file.replace(/\\/g, '/'));
    expect(direct.sort()).toEqual(['src/data/tcgArt.ts']);

    // And that shared path must stay body-less: a GET can't carry a team.
    const layer = readFileSync('src/data/fetch.ts', 'utf8');
    expect(layer).not.toMatch(/body:/);
    expect(layer).not.toMatch(/method:\s*['"`](?!GET)/i);
  });
});
