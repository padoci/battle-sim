import {useEffect, useState} from 'react';
import {tcgCardArtUrl} from '../../data/tcgArt';

/** The fanned hand's card art: a TCGdex print image URL once resolved, or
 * `undefined` while loading / if no card was found (render the existing
 * @pkmn/img icon as a fallback in that case). */
export function useTcgArt(species: string): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    setUrl(undefined);
    let live = true;
    tcgCardArtUrl(species).then(resolved => {
      if (live && resolved) setUrl(resolved);
    });
    return () => {
      live = false;
    };
  }, [species]);

  return url;
}
