import {useEffect, useMemo, useState} from 'react';
import {Icons, Sprites} from '@pkmn/img';
import {Teams, TeamValidator} from '@pkmn/sim';
import {DataClient} from '../data/client';
import {resolveMoveset, slashInfo} from '../data/resolve';
import {teamMemberToSet} from '../data/team';
import type {Moveset, PokemonSet, PoolEntry, Team} from '../data/types';
import type {ResourceMeta} from '../data/client';

const FORMAT = 'gen9ou';

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0;
  return h;
}

function PokemonIcon({species}: {species: string}) {
  const icon = Icons.getPokemon(species);
  return <span style={icon.css} title={species} />;
}

function slashText(moveset: Moveset): string[] {
  const lines: string[] = [];
  const join = (v: string | string[] | undefined) =>
    v === undefined ? undefined : Array.isArray(v) ? v.join(' / ') : v;
  for (const slot of moveset.moves) {
    lines.push(`- ${Array.isArray(slot) ? slot.join(' / ') : slot}`);
  }
  const item = join(moveset.item);
  if (item) lines.push(`Item: ${item}`);
  const ability = join(moveset.ability);
  if (ability) lines.push(`Ability: ${ability}`);
  const nature = join(moveset.nature);
  if (nature) lines.push(`Nature: ${nature}`);
  const tera = join(moveset.teratypes);
  if (tera) lines.push(`Tera: ${tera}`);
  const spreads = moveset.evs ? (Array.isArray(moveset.evs) ? moveset.evs : [moveset.evs]) : [];
  if (spreads.length > 1) lines.push(`${spreads.length} EV spreads`);
  return lines;
}

function ResolvedSet({
  label,
  set,
  validator,
}: {
  label: string;
  set: PokemonSet;
  validator: TeamValidator;
}) {
  const problems = useMemo(() => validator.validateTeam([{...set}]), [set, validator]);
  return (
    <div className="resolved">
      <div className="resolved-head">
        <span className="strategy">{label}</span>
        {problems === null ? (
          <span className="badge ok">sim-legal</span>
        ) : (
          <span className="badge bad" title={problems.join('\n')}>
            {problems.length} problem{problems.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <pre>{Teams.exportSet(set).trim()}</pre>
    </div>
  );
}

function SetsPanel({
  species,
  sets,
  validator,
}: {
  species: string;
  sets: Record<string, Moveset>;
  validator: TeamValidator;
}) {
  const sprite = Sprites.getPokemon(species, {gen: 'gen5'});
  return (
    <div>
      <h3>
        <img src={sprite.url} width={sprite.w / 2} height={sprite.h / 2} alt="" /> {species}
      </h3>
      {Object.entries(sets).map(([setName, moveset]) => {
        const info = slashInfo(moveset);
        const slashed =
          info.moveSlots.length > 0 || info.item || info.ability || info.nature ||
          info.teratypes || info.evSpreads;
        return (
          <section key={setName} className="set">
            <h4>{setName}</h4>
            <div className="set-columns">
              <div className="raw">
                <div className="col-label">wire format {slashed ? '(slashed)' : '(concrete)'}</div>
                <pre>{slashText(moveset).join('\n')}</pre>
              </div>
              <ResolvedSet
                label="resolved: first"
                set={resolveMoveset(species, moveset)}
                validator={validator}
              />
              <ResolvedSet
                label="resolved: sample (seeded)"
                set={resolveMoveset(species, moveset, {
                  strategy: 'sample',
                  rng: seededRng(hashString(species + setName)),
                })}
                validator={validator}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TeamCard({team, index}: {team: Team; index: number}) {
  const [open, setOpen] = useState(false);
  const full = useMemo(() => team.data.map(teamMemberToSet), [team]);
  return (
    <div className="team">
      <button className="team-head" onClick={() => setOpen(o => !o)}>
        <span className="team-name">{team.name ?? `Team #${index + 1}`}</span>
        <span className="team-author">{team.author ?? 'unknown'}</span>
        <span className="team-icons">
          {team.data.map(m => (
            <PokemonIcon key={m.species} species={m.species} />
          ))}
        </span>
      </button>
      {open && <pre>{full.map(s => Teams.exportSet(s).trim()).join('\n\n')}</pre>}
    </div>
  );
}

export function App() {
  const client = useMemo(() => new DataClient(FORMAT), []);
  const validator = useMemo(() => new TeamValidator(FORMAT), []);
  const [pool, setPool] = useState<PoolEntry[]>();
  const [teams, setTeams] = useState<Team[]>();
  const [meta, setMeta] = useState<ResourceMeta>();
  const [statsCount, setStatsCount] = useState<number>();
  const [selected, setSelected] = useState<string>();
  const [sets, setSets] = useState<Record<string, Moveset>>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    (async () => {
      try {
        const [loadedPool, loadedTeams, stats, setsMeta] = await Promise.all([
          client.pool(),
          client.teams(),
          client.stats(),
          client.meta('sets'),
        ]);
        setPool(loadedPool);
        setTeams(loadedTeams);
        setStatsCount(Object.keys(stats.pokemon).length);
        setMeta(setsMeta);
        const top = loadedPool[0]?.species;
        if (top) {
          setSelected(top);
          setSets(await client.setsFor(top));
        }
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [client]);

  const select = async (species: string) => {
    setSelected(species);
    setSets(await client.setsFor(species));
  };

  if (error) {
    return (
      <main>
        <h1>battle-sim · Stage 0</h1>
        <p className="error">Failed to load data: {error}</p>
      </main>
    );
  }

  return (
    <main>
      <header>
        <h1>battle-sim · Stage 0 data layer</h1>
        <p className="counts">
          {pool ? `${pool.length} pool species` : 'loading pool…'}
          {statsCount !== undefined && ` · ${statsCount} in stats`}
          {teams && ` · ${teams.length} opponent teams`}
          {meta &&
            ` · sets fetched ${Math.round((Date.now() - meta.fetchedAt) / 60000)} min ago` +
              (meta.fromCache ? ' (cache)' : ' (network)')}
        </p>
      </header>
      <div className="panels">
        <section className="panel pool">
          <h2>Draft pool</h2>
          <div className="pool-grid">
            {pool?.map(entry => (
              <button
                key={entry.species}
                className={entry.species === selected ? 'mon selected' : 'mon'}
                onClick={() => select(entry.species)}
              >
                <PokemonIcon species={entry.species} />
                <span className="mon-name">{entry.species}</span>
                <span className="usage">{(entry.usageWeighted * 100).toFixed(1)}%</span>
              </button>
            ))}
          </div>
        </section>
        <section className="panel sets">
          <h2>Sets</h2>
          {selected && sets ? (
            <SetsPanel species={selected} sets={sets} validator={validator} />
          ) : (
            <p>Select a Pokémon from the pool.</p>
          )}
        </section>
        <section className="panel teams">
          <h2>Opponent teams</h2>
          {teams?.map((team, i) => <TeamCard key={i} team={team} index={i} />)}
        </section>
      </div>
    </main>
  );
}
