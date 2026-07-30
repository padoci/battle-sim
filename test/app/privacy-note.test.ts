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
    expect(text).toMatch(/runs locally in this tab/i);
  });

  it('no longer claims there is no server, because there is one', () => {
    // The feedback endpoint (functions/api/feedback.ts) made the old phrasing
    // false. It came out rather than being left to mean less than it said; the
    // paste promise above is narrower and still exactly true.
    const {container} = render(createElement(PrivacyNote));
    expect(container.textContent ?? '').not.toMatch(/no server/i);
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

  it('sends a request with a body from exactly one place', () => {
    // This used to be "no POST anywhere", which was the stronger claim and was
    // true until the feedback panel gained an anonymous inbox. Narrowed rather
    // than deleted: one named file may POST, a second one fails this. What that
    // file is allowed to put in the body is pinned in contact.test.ts.
    const posts = sources
      .filter(s => /method:\s*['"`]POST/i.test(s.text))
      .map(s => s.file.replace(/\\/g, '/'));
    expect(posts.sort()).toEqual(['src/app/components/sendFeedback.ts']);

    // Nothing else that can carry data outward, in any file.
    const others = sources
      .filter(s => /method:\s*['"`](PUT|PATCH|DELETE)/i.test(s.text) || /sendBeacon/.test(s.text))
      .map(s => s.file);
    expect(others).toEqual([]);
  });

  it('posts feedback to this site and nowhere else', () => {
    // A relative path can only reach the origin serving the page. An absolute
    // URL here would mean messages going to some third party, which is the
    // thing the panel promises does not happen.
    const sender = readFileSync('src/app/components/sendFeedback.ts', 'utf8');
    const endpoint = sender.match(/FEEDBACK_ENDPOINT\s*=\s*'([^']+)'/)?.[1];
    expect(endpoint).toBe('/api/feedback');
    expect(sender).not.toMatch(/https?:\/\//);
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

  it('keeps request-issuing confined to the places the note describes', () => {
    // Two files take an injected `fetchFn` rather than calling the global:
    // `src/data/fetch.ts` and `src/app/components/sendFeedback.ts`. So the only
    // direct `fetch(` in the app remains the TCG art lookup, which sends a
    // species name from the draft pool and never anything from a user's team.
    // A second call site means the "only things fetched" paragraph needs
    // rewriting.
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

/**
 * The server side of the same promise.
 *
 * `src/` is no longer the whole app: there is a Pages Function now, and it runs
 * somewhere the reader cannot inspect. The endpoint's own behaviour is tested
 * in `feedback-endpoint.test.ts`; these cover the surface as a whole, so that a
 * second route added later inherits the same constraints instead of quietly
 * starting to log.
 *
 * Comments are stripped first: these files explain in prose what they refuse to
 * do, and would otherwise fail their own scan.
 */
describe('what the server side is allowed to do', () => {
  const functions = sourceFiles('functions').map(f => ({
    file: f.replace(/\\/g, '/'),
    text: readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''),
  }));

  it('has only the routes the site says it has', () => {
    // One endpoint, named in the panel and in the README. Another appearing
    // here without the wording changing is the thing this catches.
    expect(functions.map(f => f.file).sort()).toEqual(['functions/api/feedback.ts']);
  });

  it('never reads who the request came from', () => {
    const offenders = functions
      .filter(f => /cf-connecting-ip|x-forwarded-for|x-real-ip|user-agent|request\.cf/i.test(f.text))
      .map(f => f.file);
    expect(offenders).toEqual([]);
  });

  it('keeps nothing', () => {
    // No storage binding of any kind. An anonymous inbox that accumulated rows
    // would still be anonymous in the message and not in the aggregate.
    const offenders = functions
      .filter(f => /\bD1\b|\bKV\b|DurableObject|R2Bucket|caches\.default/.test(f.text))
      .map(f => f.file);
    expect(offenders).toEqual([]);
  });

  it('writes no cookies and loads no analytics', () => {
    const offenders = functions
      .filter(
        f =>
          /document\.cookie|set-cookie/i.test(f.text) ||
          /\b(gtag|googletagmanager|plausible|posthog|mixpanel|segment\.com|fathom|umami)\b/i.test(
            f.text
          )
      )
      .map(f => f.file);
    expect(offenders).toEqual([]);
  });
});
