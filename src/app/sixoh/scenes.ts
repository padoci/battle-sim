/**
 * The battle-stage background scenes.
 *
 * Extracted from SixOhGauntlet so the preloader can warm them before the
 * arena mounts: these four URLs are the whole set (the stage picks with
 * battleIndex % 4), and until one has loaded the field shows its flat blue
 * fallback colour.
 */

/** The four Gen 5-battle background scenes on Showdown's CDN. Fixed, known
 * filenames (not per-species sprite IDs), so building the URL directly is
 * safe — there's no name-mapping logic to get wrong. Mapped onto the
 * engine's real per-rung scene index (battleIndex % 4). */
export const BATTLE_SCENES = [
  {key: 'meadow', label: 'Meadow', file: 'bg-meadow.png'},
  {key: 'forest', label: 'Forest', file: 'bg-forest.png'},
  {key: 'earthycave', label: 'Earthy Cave', file: 'bg-earthycave.png'},
  {key: 'beach', label: 'Beach', file: 'bg-beach.png'},
] as const;

export function sceneUrl(file: string): string {
  return `https://play.pokemonshowdown.com/fx/${file}`;
}

let warmed = false;

/**
 * Pull all four scenes into the HTTP cache.
 *
 * The stage sets its background inline, so the image only starts downloading
 * once the field mounts — which is the same commit the battle intro mounts in.
 * The intro then plays its full "X wants to battle!" beat over `.stage-field`'s
 * flat fallback colour, and so does the first turn behind it.
 *
 * Called from the draft screen rather than the arena: every route into a
 * gauntlet passes through the draft (the arena redirects there without a run),
 * and drafting takes tens of seconds, so the fetch has finished long before it
 * is needed. Doing it on arena mount would race the very request it is meant
 * to pre-empt.
 *
 * All four, not just the next one: `battleIndex % 4` means these are the whole
 * set, together about 32KB.
 */
export function preloadScenes(): void {
  if (warmed || typeof Image === 'undefined') return;
  warmed = true;
  for (const scene of BATTLE_SCENES) {
    const img = new Image();
    img.decoding = 'async';
    img.src = sceneUrl(scene.file);
  }
}
