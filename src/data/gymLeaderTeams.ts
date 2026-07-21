import {TeamValidator} from '@pkmn/sim';
import {teamMemberToSet} from './team';
import type {GymLeaderTeam} from './types';
import gymLeaderTeamsJson from './gym-leader-teams.gen9ou.json';

const gymLeaderTeams = gymLeaderTeamsJson as unknown as GymLeaderTeam[];

/**
 * Gym Leader mode's opponent pool: real trainers' expanded rosters (see
 * scripts/build-gym-leader-teams.ts), shipped statically - no runtime fetch.
 * Re-validated against the current ruleset the same way loadOpponentTeams
 * re-validates the vendored/mined real-team pools, in case a future ban
 * change makes one of these teams illegal.
 */
export function loadGymLeaderTeams(): GymLeaderTeam[] {
  const validator = new TeamValidator('gen9ou');
  return gymLeaderTeams.filter(team => {
    try {
      return (validator.validateTeam(team.data.map(teamMemberToSet) as never) ?? []).length === 0;
    } catch {
      return false;
    }
  });
}
