import {useEffect, useState} from 'react';
import {Sprites} from '@pkmn/img';

/**
 * A Gym Leader's trainer sprite (Showdown's `/sprites/trainers/{name}.png`
 * CDN). All 25 leaders in the current roster resolve there directly, but a
 * broken/renamed asset degrades to an empty same-size circle rather than a
 * broken-image icon or a removed node (which would shift the row's layout) —
 * this is flavor, never load-bearing for reading the ladder.
 */
export function TrainerPortrait({avatarKey, className}: {avatarKey: string; className?: string}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [avatarKey]);
  const classes = ['trainer-portrait', className].filter(Boolean).join(' ');
  if (broken) return <span className={classes} aria-hidden="true" />;
  return (
    <img
      className={classes}
      src={Sprites.getAvatar(avatarKey)}
      // Showdown trainer sprites are 80x80; intrinsic dimensions reserve the
      // box (no layout shift) even before CSS applies its display size.
      width={80}
      height={80}
      alt=""
      aria-hidden="true"
      onError={() => setBroken(true)}
    />
  );
}
