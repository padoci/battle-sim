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
 * Convenience wrapper returning a ready-to-use `<img src>`. Defaults to
 * `low` quality: every card is displayed cropped down to a small illustration
 * window (see .card-art-crop in app.css), so the full-resolution scan buys
 * nothing visually while costing a lot of load time across a ten-card hand —
 * `low` is a fraction of the size of `high` and still looks sharp once
 * cropped and scaled to the small window.
 */
export async function tcgCardArtUrl(
  species: string,
  quality: 'high' | 'low' = 'low',
  ext: 'webp' | 'png' = 'webp'
): Promise<string | undefined> {
  const base = await tcgCardImageBase(species);
  return base ? `${base}/${quality}.${ext}` : undefined;
}

/**
 * Routes a card image through wsrv.nl (a free image resizing proxy) to have
 * it downscaled server-side before it reaches the browser. Even `low`
 * quality is still a full card scan — every pixel beyond what a ~150px-wide
 * cropped window (see .card-art-window in app.css) actually shows is bytes
 * spent on detail that gets thrown away, times up to ten cards on the draft
 * screen at once. `width` is sized for the window's on-screen footprint at
 * up to 2x device pixel ratio, well above what it displays but far below a
 * full scan. Purely an optimization: if the proxy is ever unreachable, the
 * caller falls back to the direct TCGdex URL (see CardArt in SixOhDraft.tsx).
 */
export function resizedCardArtUrl(url: string, width = 240): string {
  return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${width}&output=webp&q=80`;
}
