import {describe, expect, it} from 'vitest';
import {buildExportJson, buildExportMarkdown, type ExportInputs} from '../../src/analysis/export';
import {aggregateMatchup, rollUpByArchetype, summarize} from '../../src/analysis/stats';
import type {ArchetypeResult} from '../../src/analysis/archetype';
import type {RecordedBattle} from '../../src/analysis/stats';
import type {BattleResult} from '../../src/search/runner';

const rainArch: ArchetypeResult = {
  primary: 'rain',
  label: 'Rain',
  features: {offensiveCount: 4, defensiveCount: 1, offensiveMons: [], defensiveMons: [], keyMons: []},
};

function recorded(winner: 0 | 1): RecordedBattle {
  const result: BattleResult = {
    winner, turns: 25, decisions: 25, nodes: 0, msSearch: 0, msTable: 0,
    msPerDecision: {mean: 0, p50: 0, p95: 0}, nodesPerDecision: 0,
    stats: {faints: [], damageDealtFrac: [{}, {}], speedRace: {fasterCounts: [0, 0], ties: 0}},
  };
  return {teamId: 'r1', result};
}

function inputs(): ExportInputs {
  const matchup = aggregateMatchup('r1', 'Rain One', rainArch, [recorded(1), recorded(1), recorded(0)]);
  const cards = rollUpByArchetype([matchup]);
  cards[0].threats = [
    {kind: 'outspeeds-team', attackerSpecies: 'Barraskewda', evidence: 'Barraskewda outspeeds all 6 of your team'},
  ];
  cards[0].gamePlan = {sentences: ['Lead X to pressure Y.'], facts: {}};
  return {
    teamRaw: 'Great Tusk @ Leftovers\n...',
    teamWire: [{species: 'Great Tusk', ability: 'Protosynthesis', moves: ['Earthquake']}],
    n: 3,
    calibrationBattles: 3,
    cancelled: false,
    overall: summarize(cards, [matchup]),
    cards,
    poolMeta: [{teamId: 'r1', teamName: 'Rain One', weight: 2}],
    suggestions: [
      {
        kind: 'dead-weight',
        severity: 'high',
        sentence: 'Gliscor is the weakest slot; consider replacing it.',
        evidence: ['Gliscor: 5 faints in 3 battles'],
      },
    ],
    now: () => new Date('2026-07-17T12:00:00Z'),
  };
}

describe('export builders', () => {
  it('JSON carries the full analysis shape', () => {
    const json = buildExportJson(inputs());
    expect(json.version).toBe(1);
    expect(json.generatedAt).toBe('2026-07-17T12:00:00.000Z');
    expect(json.team.species).toEqual(['Great Tusk']);
    expect(json.run).toEqual({n: 3, calibrationBattles: 3, cancelled: false});
    expect(json.pool[0]).toMatchObject({teamName: 'Rain One', weight: 2, battles: 3, archetype: 'Rain'});
    expect(json.archetypes[0]).toMatchObject({
      label: 'Rain',
      battles: 3,
      distinctOpponents: 1,
      gamePlan: {sentences: ['Lead X to pressure Y.']},
    });
    expect(json.archetypes[0].threats[0].evidence).toMatch(/Barraskewda/);
    expect(json.suggestions).toEqual([
      {
        kind: 'dead-weight',
        severity: 'high',
        sentence: 'Gliscor is the weakest slot; consider replacing it.',
        evidence: ['Gliscor: 5 faints in 3 battles'],
      },
    ]);
    // Round-trips as JSON.
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it('omits the suggestions key when none are provided', () => {
    const json = buildExportJson({...inputs(), suggestions: undefined});
    expect(json.suggestions).toBeUndefined();
  });

  it('Markdown carries the report sections', () => {
    const md = buildExportMarkdown(buildExportJson(inputs()));
    expect(md).toContain('# Test Your Team Report');
    expect(md).toContain('## Verdict');
    expect(md).toContain('## Worst matchups');
    expect(md).toContain('### vs Rain: 33% (3 battles, 1 distinct opponent team)');
    expect(md).toContain('- Barraskewda outspeeds all 6 of your team');
    expect(md).toContain('**Game plan:** Lead X to pressure Y.');
    expect(md).toContain('| Rain One | Rain | 2 | 3 | 33% |');
    expect(md).toContain('Direction, not gospel');
    expect(md).toContain('## What to change');
    expect(md).toContain('- **[high]** Gliscor is the weakest slot; consider replacing it.');
    expect(md).toContain('  - Gliscor: 5 faints in 3 battles');
  });
});
