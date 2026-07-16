import {Dex} from '@pkmn/dex';
import {Generations, type Generation} from '@pkmn/data';

let gens: Generations | undefined;

/** The Gen 9 data layer (lazy — @pkmn/dex is heavy). v1 is gen 9 only. */
export function gen9(): Generation {
  gens ??= new Generations(Dex);
  return gens.get(9);
}

/**
 * A species' default ability (slot 0). Sets on data.pkmn.cc omit `ability`
 * when the standard ability is implied — the same default Showdown's
 * importer applies.
 */
export function defaultAbility(species: string): string {
  return gen9().species.get(species)?.abilities[0] ?? '';
}
