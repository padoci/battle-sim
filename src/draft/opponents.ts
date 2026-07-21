import {nextRng, sampleWithoutReplacement} from './sample';

/**
 * Choose the gauntlet's opponents: uniform, without replacement, seeded.
 * Sampled once at run start and revealed on the draft screen's ladder —
 * you draft into the field you can see.
 */
export function sampleOpponents(teamCount: number, count: number, seed: number): number[] {
  const indices = Array.from({length: teamCount}, (_, i) => i);
  const picked: number[] = [];
  let state = seed >>> 0;
  while (picked.length < Math.min(count, teamCount)) {
    const step = nextRng(state);
    state = step.state;
    const index = Math.min(indices.length - 1, Math.floor(step.value * indices.length));
    picked.push(indices[index]);
    indices.splice(index, 1);
  }
  return picked;
}

/**
 * Choose the Gym Leader gauntlet's opponents: 5 leaders with mutually
 * distinct `signatureType` (so a run never fields the same theme twice),
 * then 1 champion for the final rung — both draws seeded and without
 * replacement. Returns indices into `teams`, champion last.
 */
export function sampleGymLeaders(
  teams: ReadonlyArray<{signatureType: string; isChampion: boolean}>,
  seed: number
): number[] {
  const leaderIndicesByType = new Map<string, number[]>();
  const championIndices: number[] = [];
  teams.forEach((team, i) => {
    if (team.isChampion) {
      championIndices.push(i);
      return;
    }
    const list = leaderIndicesByType.get(team.signatureType) ?? [];
    list.push(i);
    leaderIndicesByType.set(team.signatureType, list);
  });

  const types = [...leaderIndicesByType.keys()];
  const {picked: pickedTypes, state: afterTypes} = sampleWithoutReplacement(types, () => 1, 5, seed >>> 0);

  let state = afterTypes;
  const leaders = pickedTypes.map(type => {
    const candidates = leaderIndicesByType.get(type)!;
    const step = nextRng(state);
    state = step.state;
    return candidates[Math.min(candidates.length - 1, Math.floor(step.value * candidates.length))];
  });

  const step = nextRng(state);
  const champion = championIndices[Math.min(championIndices.length - 1, Math.floor(step.value * championIndices.length))];

  return [...leaders, champion];
}
