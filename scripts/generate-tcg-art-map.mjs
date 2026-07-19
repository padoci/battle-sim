/**
 * Resolves every species in the draft pool to a TCGdex card image URL ONCE,
 * offline, and writes the result to src/data/tcgArtMap.json — the app then
 * does a synchronous object lookup instead of hitting the TCGdex search API
 * on every draft. Needs real network access to api.tcgdex.net, so this runs
 * in CI (see .github/workflows/ci.yml), not in the sandboxed dev environment.
 *
 * The matching logic (regional-form name, Rare Holo bias, whole-word
 * validation) intentionally mirrors src/data/tcgArt.ts's live fallback path
 * — species that ship in this file skip that path entirely, but a species
 * added to the pool after the map was last generated still needs it to
 * resolve correctly, so the two must stay in sync.
 *
 * Usage: node scripts/generate-tcg-art-map.mjs
 */
import {readFileSync, writeFileSync} from 'node:fs';

const CARDS_ENDPOINT = 'https://api.tcgdex.net/v2/en/cards';
const POOL_FIXTURE = new URL('../test/fixtures/gen9ou.sets.full.json', import.meta.url);
const OUT_FILE = new URL('../src/data/tcgArtMap.json', import.meta.url);
const CONCURRENCY = 5;

const REGIONAL_FORM_ADJECTIVES = {
  Alola: 'Alolan',
  Galar: 'Galarian',
  Hisui: 'Hisuian',
  Paldea: 'Paldean',
};

function baseSpeciesName(species) {
  const i = species.indexOf('-');
  return i > 0 ? species.slice(0, i) : undefined;
}

function regionalFormName(species) {
  const i = species.indexOf('-');
  if (i < 0) return undefined;
  const adjective = REGIONAL_FORM_ADJECTIVES[species.slice(i + 1)];
  return adjective ? `${adjective} ${species.slice(0, i)}` : undefined;
}

function cardNameMatches(cardName, query) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(cardName);
}

async function searchCardImage(name, rarity) {
  const params = new URLSearchParams({name});
  if (rarity) params.set('rarity', rarity);
  const res = await fetch(`${CARDS_ENDPOINT}?${params}`);
  if (!res.ok) return undefined;
  const cards = await res.json();
  return cards.find(c => c.image && cardNameMatches(c.name, name))?.image;
}

async function bestCardImage(name) {
  const classic = await searchCardImage(name, 'Rare Holo');
  return classic ?? searchCardImage(name);
}

async function resolveCardImage(species) {
  const direct = await bestCardImage(species);
  if (direct) return direct;
  const regional = regionalFormName(species);
  if (regional) {
    const viaRegionalName = await bestCardImage(regional);
    if (viaRegionalName) return viaRegionalName;
  }
  const base = baseSpeciesName(species);
  return base ? bestCardImage(base) : undefined;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, worker));
  return results;
}

const pool = JSON.parse(readFileSync(POOL_FIXTURE, 'utf8'));
const species = Object.keys(pool).sort();

console.log(`Resolving TCGdex art for ${species.length} species (concurrency ${CONCURRENCY})...`);

const map = {};
let resolved = 0;
let done = 0;
await mapWithConcurrency(species, CONCURRENCY, async name => {
  // One species failing (network hiccup, unexpected API shape) shouldn't
  // abort the other 100+ — it just falls through to the app's own live
  // fallback search at runtime, same as any species missing from the map.
  let image;
  try {
    image = await resolveCardImage(name);
  } catch (err) {
    console.warn(`  error resolving "${name}": ${err}`);
  }
  if (image) {
    map[name] = image;
    resolved++;
  } else {
    console.warn(`  no card found for "${name}"`);
  }
  done++;
  if (done % 10 === 0 || done === species.length) {
    console.log(`  ${done}/${species.length} (${resolved} resolved)`);
  }
});

const sorted = Object.fromEntries(Object.keys(map).sort().map(k => [k, map[k]]));
writeFileSync(OUT_FILE, JSON.stringify(sorted, null, 2) + '\n');
console.log(`Wrote ${resolved}/${species.length} entries to ${OUT_FILE.pathname}`);
