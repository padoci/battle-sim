import {describe, expect, it} from 'vitest';
import {parseProtocol, type ReplayEvent} from '../../src/replay/parse';
import {makeRng, pick, type Rng} from '../../src/engine/rng';
import fixture from '../fixtures/protocol.fixture.json';

/**
 * Corpus-mutation fuzzer over a real battle log.
 *
 * The protocol we parse is our OWN @pkmn/sim output, not untrusted user input,
 * so none of this is reachable from a malicious paste. It earns its place
 * because `SixOhGauntlet` re-parses the whole accumulated log on EVERY streamed
 * chunk (`toBeats(parseProtocol(log, ...))` inside a render-path useMemo), so a
 * parser throw white-screens a live battle — and a @pkmn/sim minor bump that
 * changes a line's shape is exactly the kind of thing that ships silently.
 *
 * Fixed seed, fixed iteration count: deterministic, and a failure prints the
 * mutant line so it can be pasted straight into a regression test.
 */

const LOG = (fixture as {log: string[]}).log;
/** Fixed seed + fixed count: deterministic, and cheap enough for every PR. */
const ITERATIONS = 600;

/** Lines worth breaking — the ones with a parse branch behind them. */
const INTERESTING = LOG.filter(line => {
  const kind = line.split('|')[1];
  return kind !== undefined && kind !== '' && kind !== 't:';
});

type Mutator = (line: string, rng: Rng) => string;

const MUTATORS: Array<{name: string; apply: Mutator}> = [
  {
    // The big one: a chunk boundary landing mid-line, or a field the sim
    // stopped emitting. Everything downstream reads parts[2]/parts[3] raw.
    name: 'truncate-at-a-pipe',
    apply: (line, rng) => {
      const parts = line.split('|');
      if (parts.length <= 2) return line;
      const keep = 1 + Math.floor(rng.next() * (parts.length - 1));
      return parts.slice(0, keep).join('|');
    },
  },
  {
    name: 'drop-a-field',
    apply: (line, rng) => {
      const parts = line.split('|');
      if (parts.length <= 3) return line;
      const at = 2 + Math.floor(rng.next() * (parts.length - 2));
      return [...parts.slice(0, at), ...parts.slice(at + 1)].join('|');
    },
  },
  {
    name: 'blank-a-field',
    apply: (line, rng) => {
      const parts = line.split('|');
      if (parts.length <= 2) return line;
      const at = 2 + Math.floor(rng.next() * (parts.length - 2));
      parts[at] = '';
      return parts.join('|');
    },
  },
  {
    // Targets every unguarded Number() — `-boost` deltas, `turn`, HP.
    name: 'corrupt-a-numeric',
    apply: (line, rng) => {
      const parts = line.split('|');
      const numeric = parts
        .map((p, i) => (i >= 2 && /\d/.test(p) ? i : -1))
        .filter(i => i >= 0);
      if (!numeric.length) return line;
      const at = pick(rng, numeric);
      parts[at] = pick(rng, ['abc', '', 'NaN', '-1', '1e999', 'Infinity', '1/', '/1']);
      return parts.join('|');
    },
  },
  {
    name: 'garbage-ident',
    apply: (line, rng) => {
      const parts = line.split('|');
      if (parts.length <= 2) return line;
      parts[2] = pick(rng, ['', 'nonsense', 'p3a: X', 'p1', ':', 'p1a:']);
      return parts.join('|');
    },
  },
];

interface Mutant {
  log: string[];
  what: string;
}

function mutate(rng: Rng): Mutant {
  const log = [...LOG];
  const roll = rng.next();

  // Drop the secret half of a |split| pair: the parser consumes i += 2 on
  // sight of `split`, so a missing partner shifts every subsequent line.
  if (roll < 0.1) {
    const splits = log.map((l, i) => (l.split('|')[1] === 'split' ? i : -1)).filter(i => i >= 0);
    if (splits.length) {
      const at = pick(rng, splits);
      log.splice(at + 1, 1);
      return {log, what: `dropped secret half of split at ${at}`};
    }
  }

  // Truncate the whole log mid-line — the streaming case where a chunk
  // arrives with a partial final line.
  if (roll < 0.2) {
    const at = 1 + Math.floor(rng.next() * (log.length - 1));
    const cut = log.slice(0, at);
    const last = cut[cut.length - 1] ?? '';
    cut[cut.length - 1] = last.slice(0, Math.floor(rng.next() * last.length));
    return {log: cut, what: `truncated log at ${at}, last line cut`};
  }

  const target = pick(rng, INTERESTING);
  const mutator = pick(rng, MUTATORS);
  const mutated = mutator.apply(target, rng);
  const at = log.indexOf(target);
  if (at >= 0) log[at] = mutated;
  return {log, what: `${mutator.name}: ${JSON.stringify(target)} -> ${JSON.stringify(mutated)}`};
}

/** Every numeric field the event types carry. */
function numericFields(event: ReplayEvent): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (const key of ['turn', 'hp', 'maxhp', 'delta'] as const) {
    const value = (event as unknown as Record<string, unknown>)[key];
    if (typeof value === 'number') out.push([key, value]);
  }
  return out;
}

describe('parseProtocol fuzz — malformed and truncated logs', () => {
  it('never throws on a mutated log', () => {
    const rng = makeRng(0x5eed);
    const failures: string[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const mutant = mutate(rng);
      try {
        parseProtocol(mutant.log, ['Your', 'The opposing']);
      } catch (error) {
        failures.push(`${mutant.what}\n    ${String(error)}`);
      }
    }
    expect(failures.slice(0, 5).join('\n  ')).toBe('');
    expect(failures).toHaveLength(0);
  });

  it('never emits a NaN numeric field', () => {
    const rng = makeRng(0xc0ffee);
    const failures: string[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const mutant = mutate(rng);
      let events: ReplayEvent[];
      try {
        events = parseProtocol(mutant.log, ['Your', 'The opposing']);
      } catch {
        continue; // covered by the throw test above
      }
      for (const event of events) {
        for (const [field, value] of numericFields(event)) {
          if (!Number.isFinite(value)) {
            failures.push(`${event.kind}.${field} = ${value} from ${mutant.what}`);
          }
        }
      }
    }
    expect(failures.slice(0, 5).join('\n  ')).toBe('');
  });

  it('never leaks a raw protocol string into logText', () => {
    const rng = makeRng(0xbadbeef);
    const failures: string[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const mutant = mutate(rng);
      let events: ReplayEvent[];
      try {
        events = parseProtocol(mutant.log, ['Your', 'The opposing']);
      } catch {
        continue;
      }
      for (const event of events) {
        const text = 'logText' in event ? event.logText : '';
        if (text.includes('|')) failures.push(`${JSON.stringify(text)} from ${mutant.what}`);
      }
    }
    expect(failures.slice(0, 5).join('\n  ')).toBe('');
  });

  it('never renders "undefined" or "NaN" into user-visible log text', () => {
    const rng = makeRng(0x1abe11);
    const failures: string[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const mutant = mutate(rng);
      let events: ReplayEvent[];
      try {
        events = parseProtocol(mutant.log, ['Your', 'The opposing']);
      } catch {
        continue;
      }
      for (const event of events) {
        const text = 'logText' in event ? event.logText : '';
        if (/\bundefined\b|\bNaN\b/.test(text)) {
          failures.push(`${JSON.stringify(text)} from ${mutant.what}`);
        }
      }
    }
    expect(failures.slice(0, 5).join('\n  ')).toBe('');
  });
});

describe('parseProtocol on every streaming prefix', () => {
  /**
   * The gauntlet re-parses the accumulated log on every chunk, and a chunk can
   * end anywhere — including mid-`|split|` pair. This is the case that is
   * genuinely reachable in production today.
   */
  it('never throws on any prefix of a real log', () => {
    const failures: string[] = [];
    for (let n = 0; n <= LOG.length; n++) {
      try {
        parseProtocol(LOG.slice(0, n), ['Your', 'The opposing']);
      } catch (error) {
        failures.push(`prefix length ${n} (last line ${JSON.stringify(LOG[n - 1])}): ${String(error)}`);
      }
    }
    expect(failures.slice(0, 5).join('\n  ')).toBe('');
  });

  it('never throws on a prefix whose final line is itself cut short', () => {
    const failures: string[] = [];
    for (let n = 1; n <= LOG.length; n++) {
      const prefix = LOG.slice(0, n);
      const last = prefix[n - 1];
      for (let cut = 0; cut < last.length; cut += Math.max(1, Math.floor(last.length / 4))) {
        prefix[n - 1] = last.slice(0, cut);
        try {
          parseProtocol(prefix, ['Your', 'The opposing']);
        } catch (error) {
          failures.push(`prefix ${n}, cut ${cut} (${JSON.stringify(prefix[n - 1])}): ${String(error)}`);
        }
      }
    }
    expect(failures.slice(0, 5).join('\n  ')).toBe('');
  });
});
