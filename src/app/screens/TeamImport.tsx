import {useMemo, useState} from 'react';
import {Teams, TeamValidator} from '@pkmn/sim';
import type {PokemonSet} from '../../data/types';
import {navigate} from '../router';
import {useAppDispatch} from '../state';
import {TeamPreviewRow} from '../components/TeamPreviewRow';

const PLACEHOLDER = `Paste your team in Showdown export format, e.g.

Great Tusk @ Heavy-Duty Boots
Ability: Protosynthesis
Tera Type: Water
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Headlong Rush
- Ice Spinner
- Rapid Spin
- Knock Off
...`;

export function TeamImport() {
  const dispatch = useAppDispatch();
  const validator = useMemo(() => new TeamValidator('gen9ou'), []);
  const [raw, setRaw] = useState('');

  const parsed = useMemo(() => {
    if (!raw.trim()) return undefined;
    const sets = Teams.import(raw);
    if (!sets || sets.length === 0) {
      return {sets: [] as PokemonSet[], problems: ["That doesn't parse as a Showdown team export — check the format."]};
    }
    const problems = validator.validateTeam(sets as never) ?? [];
    return {sets: sets as unknown as PokemonSet[], problems};
  }, [raw, validator]);

  const valid = parsed && parsed.sets.length > 0 && parsed.problems.length === 0;

  return (
    <main className="screen">
      <h1>Test your team</h1>
      <p className="screen-sub">Paste a Gen 9 OU team. We validate as you type.</p>
      <textarea
        className="team-input"
        value={raw}
        placeholder={PLACEHOLDER}
        onChange={event => setRaw(event.target.value)}
        rows={16}
        spellCheck={false}
      />
      {parsed && parsed.problems.length > 0 && (
        <ul className="problems">
          {parsed.problems.map((problem, i) => (
            <li key={i}>{problem}</li>
          ))}
        </ul>
      )}
      {parsed && parsed.sets.length > 0 && parsed.problems.length === 0 && (
        <TeamPreviewRow species={parsed.sets.map(s => s.species)} />
      )}
      <button
        className="primary"
        disabled={!valid}
        onClick={() => {
          if (!parsed) return;
          dispatch({type: 'SET_TEAM', sets: parsed.sets, raw});
          navigate('test-configure');
        }}
      >
        Analyze team
      </button>
    </main>
  );
}
