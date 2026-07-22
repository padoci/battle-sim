import type {TeamMemberWire} from '../data/types';
import type {ArchetypeCard, MatchupAggregate, OverallSummary} from './stats';
import type {Suggestion} from './suggestions';

/**
 * Export builders (ui-spec §6b/§9): structured JSON for the user's own
 * tooling plus a hand-templated Markdown report. Zero dependencies — both
 * are produced client-side and downloaded as Blobs.
 */
export interface DashboardExportJsonV1 {
  version: 1;
  generatedAt: string;
  format: 'gen9ou';
  team: {raw: string; species: string[]};
  run: {n: number; calibrationBattles: number; cancelled: boolean};
  overall: OverallSummary;
  /** Prescriptive "what to change" reads (absent on pre-suggestion exports). */
  suggestions?: Array<{kind: string; severity: string; sentence: string; evidence: string[]}>;
  pool: Array<{
    teamId: string;
    teamName: string;
    weight: number;
    battles: number;
    winRate: number;
    archetype: string;
  }>;
  archetypes: Array<{
    archetype: string;
    label: string;
    battles: number;
    winRate: number;
    distinctOpponents: number;
    threats: Array<{kind: string; evidence: string}>;
    gamePlan?: {sentences: string[]};
    matchups: Array<{
      teamName: string;
      battles: number;
      winRate: number;
      earliestFaints: MatchupAggregate['earliestFaints'];
      mostWork: MatchupAggregate['mostWork'];
      speedRaceWinRate: number;
      carriedBy: MatchupAggregate['carriedBy'];
    }>;
  }>;
}

export interface ExportInputs {
  teamRaw: string;
  teamWire: TeamMemberWire[];
  n: number;
  calibrationBattles: number;
  cancelled: boolean;
  overall: OverallSummary;
  cards: ArchetypeCard[];
  poolMeta: Array<{teamId: string; teamName: string; weight: number}>;
  suggestions?: Suggestion[];
  now?: () => Date;
}

export function buildExportJson(inputs: ExportInputs): DashboardExportJsonV1 {
  const matchupsByTeam = new Map<string, MatchupAggregate>();
  for (const card of inputs.cards) {
    for (const matchup of card.matchups) matchupsByTeam.set(matchup.teamId, matchup);
  }
  return {
    version: 1,
    generatedAt: (inputs.now?.() ?? new Date()).toISOString(),
    format: 'gen9ou',
    team: {raw: inputs.teamRaw, species: inputs.teamWire.map(m => m.species)},
    run: {n: inputs.n, calibrationBattles: inputs.calibrationBattles, cancelled: inputs.cancelled},
    overall: inputs.overall,
    ...(inputs.suggestions?.length
      ? {
          suggestions: inputs.suggestions.map(s => ({
            kind: s.kind,
            severity: s.severity,
            sentence: s.sentence,
            evidence: s.evidence,
          })),
        }
      : {}),
    pool: inputs.poolMeta.map(meta => {
      const matchup = matchupsByTeam.get(meta.teamId);
      return {
        ...meta,
        battles: matchup?.battles ?? 0,
        winRate: matchup?.winRate ?? 0,
        archetype: matchup?.archetype.label ?? 'unknown',
      };
    }),
    archetypes: inputs.cards.map(card => ({
      archetype: card.archetype,
      label: card.label,
      battles: card.battles,
      winRate: card.winRate,
      distinctOpponents: card.distinctOpponents,
      threats: card.threats.map(t => ({kind: t.kind, evidence: t.evidence})),
      ...(card.gamePlan ? {gamePlan: {sentences: card.gamePlan.sentences}} : {}),
      matchups: card.matchups.map(m => ({
        teamName: m.teamName,
        battles: m.battles,
        winRate: m.winRate,
        earliestFaints: m.earliestFaints,
        mostWork: m.mostWork,
        speedRaceWinRate: m.speedRaceWinRate,
        carriedBy: m.carriedBy,
      })),
    })),
  };
}

const pct = (rate: number) => `${Math.round(rate * 100)}%`;

export function buildExportMarkdown(json: DashboardExportJsonV1): string {
  const lines: string[] = [];
  const date = json.generatedAt.slice(0, 10);
  lines.push('# Test Your Team Report');
  lines.push(
    `Generated ${date} · N=${json.run.n}${json.run.calibrationBattles ? ` (${json.run.calibrationBattles} calibration included)` : ''}${json.run.cancelled ? ' · run cancelled early' : ''} · ${json.format}`
  );
  lines.push('');
  lines.push(`Team: ${json.team.species.join(' / ')}`);
  lines.push('');
  lines.push('## Verdict');
  lines.push(
    `**${json.overall.verdict}**: ${pct(json.overall.winRate)} overall win rate (${json.overall.wins}W-${json.overall.losses}L-${json.overall.draws}D over ${json.overall.battles} battles)`
  );
  lines.push('');
  lines.push('_Direction, not gospel: these are reads to pressure-test, never verdicts._');

  if (json.suggestions?.length) {
    lines.push('', '## What to change');
    for (const s of json.suggestions) {
      lines.push('', `- **[${s.severity}]** ${s.sentence}`);
      for (const line of s.evidence) lines.push(`  - ${line}`);
    }
  }

  const worst = json.archetypes.filter(a => a.winRate < 0.5);
  const best = json.archetypes.filter(a => a.winRate >= 0.5).reverse();

  const section = (title: string, cards: typeof json.archetypes) => {
    lines.push('', `## ${title}`);
    if (!cards.length) lines.push('', '_None._');
    for (const card of cards) {
      lines.push(
        '',
        `### vs ${card.label}: ${pct(card.winRate)} (${card.battles} battles, ${card.distinctOpponents} distinct opponent team${card.distinctOpponents === 1 ? '' : 's'})`
      );
      for (const threat of card.threats) lines.push(`- ${threat.evidence}`);
      if (card.gamePlan?.sentences.length) {
        lines.push('', `**Game plan:** ${card.gamePlan.sentences.join(' ')}`);
      }
    }
  };
  section('Worst matchups', worst);
  section('Best matchups', best);

  lines.push('', '## Opponent pool', '', '| Team | Archetype | Weight | Battles | Win rate |', '|---|---|---|---|---|');
  for (const row of json.pool) {
    lines.push(`| ${row.teamName} | ${row.archetype} | ${row.weight} | ${row.battles} | ${pct(row.winRate)} |`);
  }
  lines.push('');
  return lines.join('\n');
}
