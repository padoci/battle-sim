import {useMemo, useState} from 'react';
import {gen9} from '../../data/gen';
import type {PokemonSet, TeamMemberWire} from '../../data/types';
import {buildCalcTable} from '../../engine/calc/table';
import {
  aggregateMatchup,
  buildExportJson,
  buildExportMarkdown,
  buildPairingContext,
  deriveGamePlanFacts,
  renderGamePlan,
  rollUpByArchetype,
  summarize,
  threatFacts,
  type ArchetypeCard,
  type MatchupAggregate,
  type ThreatFact,
} from '../../analysis';
import type {GamePlan} from '../../analysis/gameplan';
import {navigate} from '../router';
import {useAppState, type PoolEntryWithMeta} from '../state';

interface Enrichment {
  threats: ThreatFact[];
  gamePlan: GamePlan;
}

/**
 * Calc evidence + game plan for one archetype card, derived from its WORST
 * matchup's pairing (the read the user most needs to pressure-test).
 * Built lazily per card — each pairing costs a ~200ms table build.
 */
function enrichCard(
  card: ArchetypeCard,
  userTeam: PokemonSet[],
  pool: PoolEntryWithMeta[]
): Enrichment {
  const gen = gen9();
  const worst = card.matchups[0];
  const entry = pool.find(p => p.teamId === worst.teamId);
  if (!entry) return {threats: [], gamePlan: renderGamePlan({})};

  const table = buildCalcTable(gen, [userTeam, entry.team]);
  const ctx = buildPairingContext(gen, userTeam, entry.team, table);

  // Threat facts from the opposing mons doing the most work in the sims
  // (fall back to lead order), capped for readability.
  const workhorses = worst.mostWork.slice(0, 2).map(w => w.speciesId);
  const sources = ctx.state.sides[1].mons.filter(
    m => workhorses.includes(m.speciesId) || workhorses.length === 0
  );
  const threats = sources.flatMap(mon => threatFacts(ctx, mon)).slice(0, 4);

  const facts = deriveGamePlanFacts(gen, userTeam, entry.team, table, worst);
  return {threats, gamePlan: renderGamePlan(facts)};
}

function download(filename: string, content: string, type: string): void {
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // Some browsers require the anchor to be in the document for the click to
  // trigger a download.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const pct = (rate: number) => `${Math.round(rate * 100)}%`;

function MatchupCardView({
  card,
  enrichment,
  onExpand,
  expanded,
}: {
  card: ArchetypeCard;
  enrichment?: Enrichment;
  onExpand: () => void;
  expanded: boolean;
}) {
  return (
    <div className="matchup-card">
      <button className="matchup-head" onClick={onExpand}>
        <span className="matchup-title">vs {card.label}</span>
        <span className="matchup-rate mono">{pct(card.winRate)}</span>
        <span className="matchup-meta mono">
          {card.battles} battles · {card.distinctOpponents} team{card.distinctOpponents === 1 ? '' : 's'}
        </span>
      </button>
      {expanded && (
        <div className="matchup-body">
          {!enrichment && <p className="hint">Building calc evidence…</p>}
          {enrichment && (
            <>
              {enrichment.threats.length > 0 && (
                <ul className="threats mono">
                  {enrichment.threats.map((threat, i) => (
                    <li key={i}>{threat.evidence}</li>
                  ))}
                </ul>
              )}
              <div className="game-plan">
                <h4>Game plan</h4>
                {enrichment.gamePlan.sentences.map((sentence, i) => (
                  <p key={i}>{sentence}</p>
                ))}
              </div>
            </>
          )}
          <div className="matchup-detail mono">
            {card.matchups.map(m => (
              <MatchupDetail key={m.teamId} matchup={m} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MatchupDetail({matchup}: {matchup: MatchupAggregate}) {
  const gen = gen9();
  const name = (id: string) => gen.species.get(id)?.name ?? id;
  const firstFaint = matchup.earliestFaints[0];
  const workhorse = matchup.mostWork[0];
  const carried = matchup.carriedBy[0];
  return (
    <div className="matchup-detail-row">
      <div>
        {matchup.teamName}: {pct(matchup.winRate)} over {matchup.battles}
      </div>
      {firstFaint && (
        <div>
          {name(firstFaint.speciesId)} faints earliest (turn ~{firstFaint.meanTurn.toFixed(0)}
          {firstFaint.topCause ? `, usually to ${name(firstFaint.topCause)}` : ''})
        </div>
      )}
      {workhorse && <div>{name(workhorse.speciesId)} does their heavy lifting</div>}
      {carried && <div>{name(carried.speciesId)} carries your wins</div>}
      <div>you win the speed race {pct(matchup.speedRaceWinRate)} of turns</div>
    </div>
  );
}

export function Dashboard() {
  const state = useAppState();
  const [expanded, setExpanded] = useState<string>();
  const [enrichments, setEnrichments] = useState<Record<string, Enrichment>>({});
  const [downloaded, setDownloaded] = useState<string>();

  const {team, pool, run} = state;

  const analysis = useMemo(() => {
    if (!team || run.battles.length === 0) return undefined;
    const byTeam = new Map<string, typeof run.battles>();
    for (const battle of run.battles) {
      byTeam.set(battle.teamId, [...(byTeam.get(battle.teamId) ?? []), battle]);
    }
    const matchups = [...byTeam.entries()]
      .map(([teamId, battles]) => {
        const entry = pool.find(p => p.teamId === teamId);
        // Skip battles whose team is no longer in the pool (stale state) rather
        // than assert non-null and blank the app.
        if (!entry) return undefined;
        return aggregateMatchup(teamId, entry.teamName, entry.archetype, battles);
      })
      .filter((m): m is NonNullable<typeof m> => m !== undefined);
    const cards = rollUpByArchetype(matchups);
    return {matchups, cards, overall: summarize(cards, matchups)};
  }, [team, pool, run.battles]);

  if (!team || !analysis) {
    return (
      <main className="screen">
        <div className="empty-state">
          No results yet — <a href="#/test/configure">run some battles</a> and the matchup reads
          land here.
        </div>
      </main>
    );
  }

  const {cards, overall} = analysis;
  const worst = cards.filter(c => c.winRate < 0.5);
  const best = cards.filter(c => c.winRate >= 0.5).slice().reverse();

  const ensureEnriched = (card: ArchetypeCard): Enrichment | undefined => {
    const existing = enrichments[card.archetype];
    if (existing) return existing;
    // Compute synchronously on first expand (a ~200ms table build).
    const enrichment = enrichCard(card, team.sets, pool);
    setEnrichments(prev => ({...prev, [card.archetype]: enrichment}));
    return enrichment;
  };

  const exportAll = (format: 'json' | 'md') => {
    const enrichedCards = cards.map(card => ({
      ...card,
      threats: (enrichments[card.archetype] ?? enrichCard(card, team.sets, pool)).threats,
      gamePlan: (enrichments[card.archetype] ?? enrichCard(card, team.sets, pool)).gamePlan,
    }));
    const json = buildExportJson({
      teamRaw: team.raw,
      teamWire: team.sets as unknown as TeamMemberWire[],
      n: run.n,
      calibrationBattles: Math.min(10, run.battles.length),
      cancelled: run.status === 'cancelled',
      overall,
      cards: enrichedCards,
      poolMeta: pool.map(p => ({teamId: p.teamId, teamName: p.teamName, weight: p.weight})),
    });
    const filename = format === 'json' ? 'team-report.json' : 'team-report.md';
    if (format === 'json') {
      download(filename, JSON.stringify(json, null, 2), 'application/json');
    } else {
      download(filename, buildExportMarkdown(json), 'text/markdown');
    }
    setDownloaded(filename);
  };

  const column = (title: string, list: ArchetypeCard[]) => (
    <section className="matchup-column">
      <h2>{title}</h2>
      {list.length === 0 && <p className="hint">None in this band yet — run more battles to fill it in.</p>}
      {list.map(card => (
        <MatchupCardView
          key={card.archetype}
          card={card}
          enrichment={enrichments[card.archetype]}
          expanded={expanded === card.archetype}
          onExpand={() => {
            const next = expanded === card.archetype ? undefined : card.archetype;
            setExpanded(next);
            if (next) ensureEnriched(card);
          }}
        />
      ))}
    </section>
  );

  return (
    <main className="screen dashboard">
      <header className="verdict">
        <h1>{overall.verdict}</h1>
        <p className="mono">
          {pct(overall.winRate)} win rate · {overall.wins}W-{overall.losses}L-{overall.draws}D over{' '}
          {overall.battles} battles
          {run.status === 'cancelled' ? ' · cancelled early (partial)' : ''}
          {run.status === 'running' || run.status === 'calibrating' ? ' · still running…' : ''}
        </p>
        <p className="hint">Direction, not gospel — reads to pressure-test, never verdicts.</p>
      </header>

      <div className="matchup-columns">
        {column('Worst matchups', worst)}
        {column('Best matchups', best)}
      </div>

      <footer className="dashboard-actions">
        <button onClick={() => exportAll('json')}>Export JSON</button>
        <button onClick={() => exportAll('md')}>Export Markdown</button>
        <button onClick={() => navigate('test-import')}>Tweak team</button>
        <button onClick={() => navigate('test-configure')}>Re-run</button>
      </footer>
      {downloaded && (
        <p className="hint mono download-note" role="status">Downloaded {downloaded} ✓</p>
      )}
    </main>
  );
}
