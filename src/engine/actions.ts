import type {Battle} from '@pkmn/sim';

/** One legal choice for one side of one turn. */
export type Action =
  | {kind: 'move'; slot: 1 | 2 | 3 | 4; tera?: true}
  | {kind: 'switch'; slot: 2 | 3 | 4 | 5 | 6}
  | {kind: 'pass'};

/** The wire choice string `battle.makeChoices` expects. */
export function toChoice(action: Action): string {
  switch (action.kind) {
    case 'move':
      return `move ${action.slot}${action.tera ? ' terastallize' : ''}`;
    case 'switch':
      return `switch ${action.slot}`;
    case 'pass':
      return '';
  }
}

interface RequestMove {
  disabled?: boolean;
}
interface ActiveRequest {
  moves: RequestMove[];
  trapped?: boolean;
  canTerastallize?: string;
}

/**
 * Legal actions for one side, derived from its current request object.
 * Every returned action's `toChoice` string is accepted by a
 * `strictChoices` battle (tested against the sim).
 */
export function legalActions(battle: Battle, side: 0 | 1): Action[] {
  const request = battle.sides[side].activeRequest as {
    wait?: boolean;
    forceSwitch?: boolean[];
    active?: ActiveRequest[];
  } | null;
  if (!request || request.wait) return [{kind: 'pass'}];

  const actions: Action[] = [];
  const switches: Action[] = [];
  const pokemon = battle.sides[side].pokemon;
  for (let i = 1; i < pokemon.length; i++) {
    if (!pokemon[i].fainted && !pokemon[i].isActive) {
      switches.push({kind: 'switch', slot: (i + 1) as 2 | 3 | 4 | 5 | 6});
    }
  }

  if (request.forceSwitch) return switches;

  const active = request.active?.[0];
  if (!active) return [{kind: 'pass'}];

  active.moves.forEach((move, i) => {
    if (move.disabled) return;
    const slot = (i + 1) as 1 | 2 | 3 | 4;
    actions.push({kind: 'move', slot});
    if (active.canTerastallize) actions.push({kind: 'move', slot, tera: true});
  });
  if (!active.trapped) actions.push(...switches);
  return actions;
}
