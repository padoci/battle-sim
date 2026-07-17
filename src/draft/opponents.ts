import {nextRng} from './sample';

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
