/**
 * Card art for the draft's fanned hand, sourced from the TCGdex API
 * (https://tcgdex.dev) — real Pokémon TCG print art, matching the app's
 * trading-card visual language. This is presentation-only "flavor" art (not
 * game data), so a lookup miss just means falling back to the existing
 * @pkmn/img icon — never a hard failure.
 *
 * Species→art is resolved ONCE, offline, by scripts/generate-tcg-art-map.mjs
 * (mirrors the matching logic below) and checked in as tcgArtMap.json — a
 * card draft never needs to hit the TCGdex search API itself, only fetch
 * the (proxied, resized) image for whatever tcgArtMap.json already points
 * at. The live search code below only runs for a species that map doesn't
 * cover yet (e.g. one added since the map was last generated).
 */
import artMap from './tcgArtMap.json';

const CARDS_ENDPOINT = 'https://api.tcgdex.net/v2/en/cards';

interface CardBrief {
  id: string;
  name: string;
  image?: string;
}

const cache = new Map<string, Promise<string | undefined>>();

/** Most Showdown form suffixes ("Landorus-Therian", "Ogerpon-Wellspring",
 * "Slowking-Galar") aren't printed as separately-named TCG cards — fall back
 * to the base species when the exact form doesn't turn up a card. */
function baseSpeciesName(species: string): string | undefined {
  const i = species.indexOf('-');
  return i > 0 ? species.slice(0, i) : undefined;
}

/** Showdown writes regional forms as "Species-Region" (e.g. "Slowking-Galar",
 * "Moltres-Galar"); the TCG prints them as "Region-adjective Species" (e.g.
 * "Galarian Slowking"). Without this, a search for "Slowking-Galar" never
 * matches and silently falls back to whatever plain "Slowking" print turns
 * up — the wrong color palette and type for a regional form. Only covers
 * the regions with a well-established, consistent TCG naming convention;
 * anything else (Therian, Origin, Primal, ...) still falls back to the base
 * species below, same as before. */
const REGIONAL_FORM_ADJECTIVES: Record<string, string> = {
  Alola: 'Alolan',
  Galar: 'Galarian',
  Hisui: 'Hisuian',
  Paldea: 'Paldean',
};

function regionalFormName(species: string): string | undefined {
  const i = species.indexOf('-');
  if (i < 0) return undefined;
  const adjective = REGIONAL_FORM_ADJECTIVES[species.slice(i + 1)];
  return adjective ? `${adjective} ${species.slice(0, i)}` : undefined;
}

/** TCGdex's search is "laxist" (fuzzy substring, its own docs' word) rather
 * than exact — it can hand back a loosely-related card instead of an empty
 * result (seen in practice: a "Dragonite" search returning a Pikachu print,
 * "Ogerpon" returning an unrelated Ghost-type card). Require the card's own
 * name to actually contain the species as a whole word before trusting it —
 * a word-boundary check rather than an exact match, so "Dragonite ex" /
 * "Radiant Dragonite" still pass for a "Dragonite" query, but an unrelated
 * name that merely shares a substring doesn't. */
function cardNameMatches(cardName: string, query: string): boolean {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(cardName);
}

async function searchCardImage(name: string, rarity?: string): Promise<string | undefined> {
  try {
    const params = new URLSearchParams({name});
    if (rarity) params.set('rarity', rarity);
    const res = await fetch(`${CARDS_ENDPOINT}?${params}`);
    if (!res.ok) return undefined;
    const cards = (await res.json()) as CardBrief[];
    return cards.find(c => c.image && cardNameMatches(c.name, name))?.image;
  } catch {
    // Offline, blocked, or the API is down — treat exactly like "no card found".
    return undefined;
  }
}

/** .card-art (app.css) crops down to a fixed illustration-region rectangle,
 * which only matches the classic template — full-art/ex/VMAX prints paint
 * over the whole card and crop wrong under that same rectangle. "Rare Holo"
 * is the most common classic-template rarity that still covers
 * high-profile Pokémon (most get at least one basic reprint), so try it
 * before falling back to whatever print turns up first. Sequential, not
 * parallel: most species have a Rare Holo print, so this is one search
 * request most of the time rather than two for every one of the ten cards
 * on screen at once. */
async function bestCardImage(name: string): Promise<string | undefined> {
  const classic = await searchCardImage(name, 'Rare Holo');
  return classic ?? searchCardImage(name);
}

async function resolveCardImage(species: string): Promise<string | undefined> {
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

/** Which card template an image belongs to, read off the series segment of a
 * TCGdex path (`assets.tcgdex.net/en/<series>/<set>/<number>`). The three
 * groups crop differently — see `.card-art` in app.css for the rectangles.
 * Anything unrecognised (a series added after this was written) falls through
 * to the modern default, which is what every recent set uses. */
const MID_ERA_SERIES = new Set(['xy', 'bw', 'dp', 'pl', 'hgss', 'col', 'pop']);
const VINTAGE_SERIES = new Set(['base', 'gym', 'neo']);

export function cardArtEra(url: string): 'era-mid' | 'era-vintage' | undefined {
  const series = url.split('/')[4];
  if (VINTAGE_SERIES.has(series)) return 'era-vintage';
  if (MID_ERA_SERIES.has(series)) return 'era-mid';
  return undefined;
}

export interface ArtRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Per-species crop overrides.
 *
 * A handful of prints paint card text over the illustration itself rather
 * than beside it — the Tera prints put a rules box across the top of the art —
 * so the era rectangle lands on type instead of artwork. These are the ones
 * `bestCardImage` could not avoid: no classic-template print of the species
 * exists in the map. Every rect here must satisfy the same w/h >= 2.35 rule
 * as the era classes (asserted in test/app/fx-signature-css.test.ts).
 */
export const ART_RECT_OVERRIDES: Record<string, ArtRect> = {
  // The Tera rules box occupies roughly the top third of the illustration;
  // start below it and take the shorter band that is left.
  Ogerpon: {x: 0.06, y: 0.245, w: 0.88, h: 0.235},
  'Ogerpon-Cornerstone': {x: 0.06, y: 0.245, w: 0.88, h: 0.235},
  'Ogerpon-Wellspring': {x: 0.06, y: 0.245, w: 0.88, h: 0.235},
  Dragapult: {x: 0.06, y: 0.245, w: 0.88, h: 0.235},
};

/**
 * Resolves a species to a TCGdex card image URL (a base path — callers
 * append `/<quality>.<ext>`, e.g. `/high.webp`), or `undefined` if no card
 * art could be found. Cached per species for the life of the page.
 */
export function tcgCardImageBase(species: string): Promise<string | undefined> {
  const embedded = (artMap as Record<string, string>)[species];
  if (embedded) return Promise.resolve(embedded);

  let promise = cache.get(species);
  if (!promise) {
    promise = resolveCardImage(species);
    cache.set(species, promise);
  }
  return promise;
}

/**
 * Convenience wrapper returning a ready-to-use `<img src>`.
 *
 * `high` rather than `low`, because the window does not show the card — it
 * shows a crop of roughly a third of its height, blown back up to fill the
 * window (see .card-art in app.css). That puts the card's full width at about
 * 190 CSS px on screen, so a 2x display wants ~380 source px and `low` only
 * carries 245: every retina draft screen was upscaling. The proxy below
 * brings the transferred size back down.
 */
export async function tcgCardArtUrl(
  species: string,
  quality: 'high' | 'low' = 'high',
  ext: 'webp' | 'png' = 'webp'
): Promise<string | undefined> {
  const base = await tcgCardImageBase(species);
  return base ? `${base}/${quality}.${ext}` : undefined;
}

/**
 * Routes a card image through wsrv.nl (a free image resizing proxy) to have
 * it downscaled server-side before it reaches the browser. A `high` scan is
 * 600-734px wide; every pixel beyond what the cropped window (see .card-art
 * in app.css) actually shows is bytes spent on detail that gets thrown away,
 * times up to ten cards on the draft screen at once.
 *
 * `width` is sized for the card's on-screen footprint at 2x device pixel
 * ratio — ~190 CSS px of card, so ~380 source px. Measured on a real card,
 * that lands at ~28 KB against ~14 KB for the old (too small to be sharp)
 * 240px request. Purely an optimization: if the proxy is ever unreachable
 * the caller falls back to the direct TCGdex URL (see CardArt in
 * SixOhDraft.tsx), which is heavier but frames identically — the crop is
 * done in CSS, not here.
 */
export function resizedCardArtUrl(url: string, width = 384): string {
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${width}&output=webp&q=72`;
}
