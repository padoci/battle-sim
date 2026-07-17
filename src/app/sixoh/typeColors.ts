/**
 * The standard Pokémon type-color map — the functional accent system
 * (ui-spec §2): HP bars, type badges, and move tags all read from here.
 */
export const TYPE_COLORS: Record<string, string> = {
  normal: '#A8A77A',
  fire: '#EE8130',
  water: '#6390F0',
  electric: '#F7D02C',
  grass: '#7AC74C',
  ice: '#96D9D6',
  fighting: '#C22E28',
  poison: '#A33EA1',
  ground: '#E2BF65',
  flying: '#A98FF3',
  psychic: '#F95587',
  bug: '#A6B91A',
  rock: '#B6A136',
  ghost: '#735797',
  dragon: '#6F35FC',
  dark: '#705746',
  steel: '#B7B7CE',
  fairy: '#D685AD',
  stellar: '#40B5A5',
};

export function typeColor(type: string | undefined): string {
  return TYPE_COLORS[(type ?? '').toLowerCase()] ?? '#9aa1ab';
}
