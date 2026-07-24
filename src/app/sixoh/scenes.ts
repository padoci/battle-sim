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
