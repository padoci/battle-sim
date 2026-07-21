import {describe, expect, it} from 'vitest';
import {sampleGymLeaders, sampleOpponents} from '../../src/draft/opponents';

describe('sampleOpponents', () => {
  it('returns distinct indices, deterministic per seed', () => {
    const a = sampleOpponents(10, 6, 42);
    const b = sampleOpponents(10, 6, 42);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(6);
    expect(a.every(i => i >= 0 && i < 10)).toBe(true);
  });

  it('caps at population and varies across seeds', () => {
    expect(sampleOpponents(4, 6, 1)).toHaveLength(4);
    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed++) seen.add(sampleOpponents(10, 6, seed).join(','));
    expect(seen.size).toBeGreaterThan(20);
  });

  it('is roughly uniform over many seeds', () => {
    const counts = new Array(10).fill(0);
    for (let seed = 0; seed < 500; seed++) {
      for (const index of sampleOpponents(10, 6, seed)) counts[index]++;
    }
    // Each index expected ~300 times (500 x 6/10).
    for (const count of counts) {
      expect(count).toBeGreaterThan(230);
      expect(count).toBeLessThan(370);
    }
  });
});

describe('sampleGymLeaders', () => {
  // 3 leaders per type (A/B/C) across 3 types, plus 2 champions, indexed 0..10.
  const teams = [
    {signatureType: 'A', isChampion: false}, // 0
    {signatureType: 'A', isChampion: false}, // 1
    {signatureType: 'B', isChampion: false}, // 2
    {signatureType: 'B', isChampion: false}, // 3
    {signatureType: 'C', isChampion: false}, // 4
    {signatureType: 'C', isChampion: false}, // 5
    {signatureType: 'D', isChampion: false}, // 6
    {signatureType: 'E', isChampion: false}, // 7
    {signatureType: 'F', isChampion: false}, // 8
    {signatureType: 'champ1', isChampion: true}, // 9
    {signatureType: 'champ2', isChampion: true}, // 10
  ];

  it('picks 5 leaders with mutually distinct signatureType + 1 champion last, deterministic per seed', () => {
    const a = sampleGymLeaders(teams, 7);
    const b = sampleGymLeaders(teams, 7);
    expect(a).toEqual(b);
    expect(a).toHaveLength(6);

    const leaderIdx = a.slice(0, 5);
    const championIdx = a[5];
    expect(new Set(leaderIdx).size).toBe(5);
    const types = leaderIdx.map(i => teams[i].signatureType);
    expect(new Set(types).size).toBe(5);
    expect(leaderIdx.every(i => !teams[i].isChampion)).toBe(true);
    expect(teams[championIdx].isChampion).toBe(true);
  });

  it('varies the drawn types and champion across seeds', () => {
    const seenTypeSets = new Set<string>();
    const seenChampions = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      const result = sampleGymLeaders(teams, seed);
      seenTypeSets.add(result.slice(0, 5).map(i => teams[i].signatureType).sort().join(','));
      seenChampions.add(result[5]);
    }
    expect(seenTypeSets.size).toBeGreaterThan(1);
    expect(seenChampions).toEqual(new Set([9, 10]));
  });
});
