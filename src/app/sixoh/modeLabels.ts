import type {DraftMode} from '../../draft/draft';

/** User-facing names for the difficulty modes. Internal ids stay
 * gymleader/easy/hard (state, hash params, tuning tables); only the display
 * layer speaks these. The hash also accepts ?mode=normal as an alias. */
export const MODE_LABELS: Record<DraftMode, string> = {
  gymleader: 'Gym Challenge',
  easy: 'Normal',
  hard: 'Hard',
};
