import {useEffect, useState} from 'react';
import {Sprites} from '@pkmn/img';

/**
 * A Gym Leader's trainer sprite (Showdown's `/sprites/trainers/{name}.png`
 * CDN). All 25 leaders in the current roster resolve there directly, but a
 * broken/renamed asset degrades to nothing rather than a broken-image icon —
 * this is flavor, never load-bearing for reading the ladder.
 */
export function TrainerPortrait({avatarKey, className}: {avatarKey: string; className?: string}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [avatarKey]);
  if (broken) return null;
  return (
    <img
      className={['trainer-portrait', className].filter(Boolean).join(' ')}
      src={Sprites.getAvatar(avatarKey)}
      alt=""
      aria-hidden="true"
      onError={() => setBroken(true)}
    />
  );
}
