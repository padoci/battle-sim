/**
 * Card art for the draft's fanned hand, sourced from the TCGdex API
 * (https://tcgdex.dev) — real Pokémon TCG print art, matching the app's
 * trading-card visual language. This is presentation-only "flavor" art (not
 * game data), so a lookup miss just means falling back to the existing
 * @pkmn/img icon — never a hard failure.
 */

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

async function searchCardImage(name: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${CARDS_ENDPOINT}?name=${encodeURIComponent(name)}`);
    if (!res.ok) return undefined;
    const cards = (await res.json()) as CardBrief[];
    return cards.find(c => c.image)?.image;
  } catch {
    // Offline, blocked, or the API is down — treat exactly like "no card found".
    return undefined;
  }
}

/**
 * Resolves a species to a TCGdex card image URL (a base path — callers
 * append `/<quality>.<ext>`, e.g. `/high.webp`), or `undefined` if no card
 * art could be found. Cached per species for the life of the page.
 */
export function tcgCardImageBase(species: string): Promise<string | undefined> {
  let promise = cache.get(species);
  if (!promise) {
    promise = searchCardImage(species).then(image => {
      if (image) return image;
      const base = baseSpeciesName(species);
      return base ? searchCardImage(base) : undefined;
    });
    cache.set(species, promise);
  }
  return promise;
}

/** Convenience wrapper returning a ready-to-use `<img src>`. */
export async function tcgCardArtUrl(
  species: string,
  quality: 'high' | 'low' = 'high',
  ext: 'webp' | 'png' = 'webp'
): Promise<string | undefined> {
  const base = await tcgCardImageBase(species);
  return base ? `${base}/${quality}.${ext}` : undefined;
}
