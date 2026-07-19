/**
 * Mine real high-ladder gen9ou team *compositions* from public Pokémon
 * Showdown replays, and pair each with a standard competitive build
 * (data.pkmn.cc sets — the same source the Draft feature already uses) to
 * produce full, validated teams. A bigger, more diverse supplement to the
 * hand-curated + crob.at opponent pool.
 *
 * Honesty note: Showdown replays never reveal EVs, nature, or a player's full
 * moveset to spectators — only species (via Team Preview) and whatever gets
 * exposed mid-battle. So a "mined" team is a real high-ladder *core* (which 6
 * species a 1700+-rated player actually brought together) paired with the
 * standard set for each species, not a literal paste of that player's exact
 * spread. Every team is still validated as gen9ou before being kept.
 *
 *   npx vite-node scripts/mine-ladder-teams.ts
 */
import {writeFileSync} from 'node:fs';
import {TeamValidator} from '@pkmn/sim';
import {MemoryStore} from '../src/data/cache';
import {DataClient} from '../src/data/client';
import {resolveMoveset} from '../src/data/resolve';
import {setToTeamMember} from '../src/data/team';
import type {Moveset, PokemonSet, Team} from '../src/data/types';

const OUT = 'src/data/mined-teams.gen9ou.json';
/** Rating a side must show (from the replay's own `|player|` line) to count
 *  as "high ladder" — well above the format's median (measured: only ~2% of
 *  recent replays have a side this high). */
const RATING_THRESHOLD = 1700;
/** We don't need tons of these — a couple dozen genuinely high-ladder,
 *  diverse cores is the goal, not maximum volume. */
const TARGET_TEAMS = 30;
/** Generous but bounded — stop paging even if the target isn't hit. */
const MAX_PAGES = 100;
const CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 10000;

async function fetchJson<T>(url: string): Promise<T | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {signal: controller.signal});
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** A hidden/undetermined Team Preview forme ("Zamazenta-*") isn't a real OU
 *  staple forme on its own — fall back to the base species. */
function normalizeSpecies(raw: string): string {
  const name = raw.split(',')[0].trim();
  return name.endsWith('-*') ? name.slice(0, -2) : name;
}

interface Side {
  elo: number;
  species: string[];
}

/** Both sides of one replay, if parseable: elo (from `|player|`) and the
 *  Team Preview roster (from `|poke|`) for each. Gen 9 OU is Team Preview, so
 *  the roster is complete regardless of what was actually played out. */
function parseSides(log: string): {p1?: Side; p2?: Side} {
  const elo: {p1?: number; p2?: number} = {};
  const species: {p1: string[]; p2: string[]} = {p1: [], p2: []};
  for (const line of log.split('\n')) {
    const player = /^\|player\|(p1|p2)\|[^|]*\|[^|]*\|(\d+)/.exec(line);
    if (player) {
      elo[player[1] as 'p1' | 'p2'] = Number(player[2]);
      continue;
    }
    const poke = /^\|poke\|(p1|p2)\|([^|]*)\|?/.exec(line);
    if (poke) species[poke[1] as 'p1' | 'p2'].push(normalizeSpecies(poke[2]));
  }
  const out: {p1?: Side; p2?: Side} = {};
  if (elo.p1 !== undefined && species.p1.length === 6) out.p1 = {elo: elo.p1, species: species.p1};
  if (elo.p2 !== undefined && species.p2.length === 6) out.p2 = {elo: elo.p2, species: species.p2};
  return out;
}

/** Order-independent species-set signature, for dedup (mirrors mergeTeams'). */
function signature(species: string[]): string {
  return [...species].sort().join('|');
}

/** Run `fn` over `items` with bounded concurrency (order doesn't matter here). */
async function forEachPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) await fn(items[cursor++]);
  };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
}

/**
 * When a species has multiple named sets and there's no direct set-level
 * popularity signal, prefer whichever set's item is most common for that
 * species per usage stats — item is usually the most differentiating choice
 * between named sets (e.g. Choice Scarf vs. bulky vs. utility).
 */
function pickSetName(setNames: string[], sets: Record<string, Moveset>, itemFreq: Record<string, number> | undefined): string {
  if (setNames.length === 1) return setNames[0];
  let best = setNames[0];
  let bestScore = -1;
  for (const name of setNames) {
    const item = sets[name].item;
    const key = Array.isArray(item) ? item[0] : item;
    const score = (key && itemFreq?.[key]) ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return best;
}

async function main() {
  const client = new DataClient('gen9ou', {store: new MemoryStore()});
  const [sets, stats] = await Promise.all([client.sets(), client.stats()]);
  const validator = new TeamValidator('gen9ou');

  const seen = new Set<string>();
  const mined: Team[] = [];

  outer: for (let page = 1; page <= MAX_PAGES; page++) {
    const list = await fetchJson<Array<{id: string}>>(
      `https://replay.pokemonshowdown.com/search.json?format=gen9ou&page=${page}`
    );
    if (!list || list.length === 0) {
      console.log(`page ${page}: empty — reached the end of available replays`);
      break;
    }

    const candidates: string[][] = [];
    await forEachPool(list, CONCURRENCY, async entry => {
      const replay = await fetchJson<{log: string}>(`https://replay.pokemonshowdown.com/${entry.id}.json`);
      if (!replay?.log) return;
      const {p1, p2} = parseSides(replay.log);
      for (const side of [p1, p2]) {
        if (side && side.elo >= RATING_THRESHOLD) candidates.push(side.species);
      }
    });

    for (const species of candidates) {
      const sig = signature(species);
      if (seen.has(sig)) continue;
      seen.add(sig);

      const perSpeciesSets = species.map(s => sets[s]);
      if (perSpeciesSets.some(s => !s)) continue; // a species we have no set data for at all

      const chosen: PokemonSet[] = species.map((s, i) => {
        const names = Object.keys(perSpeciesSets[i]);
        const name = pickSetName(names, perSpeciesSets[i], stats.pokemon[s]?.items);
        return resolveMoveset(s, perSpeciesSets[i][name]);
      });

      const problems = validator.validateTeam(chosen as never) ?? [];
      if (problems.length) continue;

      // A single top-usage anchor collides constantly — a handful of staples
      // (Great Tusk, Gholdengo, Kingambit...) top nearly every high-ladder
      // team. Two anchors differentiate far better in practice.
      const [first, second] = [...species].sort(
        (a, b) => (stats.pokemon[b]?.usage.weighted ?? 0) - (stats.pokemon[a]?.usage.weighted ?? 0)
      );
      let name = `High Ladder Comp: ${first} + ${second}`;
      if (mined.some(t => t.name === name)) name = `${name} (${species.join('/')})`;
      mined.push({
        name,
        author: `mined · ${RATING_THRESHOLD}+ ladder`,
        data: chosen.map(setToTeamMember),
      });
      console.log(`ok  ${mined.length}/${TARGET_TEAMS}: ${species.join(', ')}`);
      if (mined.length >= TARGET_TEAMS) break outer;
    }

    console.log(`page ${page} done — ${mined.length}/${TARGET_TEAMS} teams so far`);
  }

  writeFileSync(OUT, `${JSON.stringify(mined, null, 2)}\n`);
  console.log(`wrote ${OUT} with ${mined.length} team(s)`);
}

main();
