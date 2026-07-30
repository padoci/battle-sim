import {useEffect, useMemo, useState} from 'react';
import {Teams, TeamValidator} from '@pkmn/sim';
import type {PokemonSet} from '../../data/types';
import {EXAMPLE_TEAM} from '../../data/exampleTeam';
import {navigate} from '../router';
import {useAppDispatch, useAppState} from '../state';
import {PrivacyNote} from '../components/PrivacyNote';
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

/**
 * The pasted team survives a reload. In-session navigation already kept it
 * (Back from Configure returns it intact), but a refresh dropped it and sent
 * the user off to find their export again — the sharpest edge of losing a run,
 * and the cheapest to remove.
 */
const DRAFT_KEY = 'teampreview:team-draft';

/**
 * The pre-rename key. Unlike the HTTP cache, this holds something the user
 * typed and cannot be re-fetched, so the rename reads it forward instead of
 * abandoning it: someone who pasted a team, refreshed, and landed on the
 * renamed build still finds their export in the box. Safe to delete once no
 * one plausibly has a draft from before the rename.
 */
const LEGACY_DRAFT_KEY = 'battle-sim:team-draft';

/** Exported for test/app/draft-key-migration.test.ts; not used elsewhere. */
export function loadDraft(): string {
  try {
    const current = localStorage.getItem(DRAFT_KEY);
    if (current !== null) return current;
    const legacy = localStorage.getItem(LEGACY_DRAFT_KEY);
    if (legacy === null) return '';
    // Carry it forward once, then stop paying for the lookup.
    localStorage.setItem(DRAFT_KEY, legacy);
    localStorage.removeItem(LEGACY_DRAFT_KEY);
    return legacy;
  } catch {
    return '';
  }
}

export function TeamImport() {
  const dispatch = useAppDispatch();
  const {team} = useAppState();
  const validator = useMemo(() => new TeamValidator('gen9ou'), []);
  // Prefill with the previously analyzed team so "Tweak team" doesn't dump the
  // user back to a blank box, then with whatever survived the last reload.
  const [raw, setRaw] = useState(() => team?.raw ?? loadDraft());

  useEffect(() => {
    try {
      if (raw.trim()) localStorage.setItem(DRAFT_KEY, raw);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Private mode / quota — the box just won't survive a reload.
    }
  }, [raw]);

  const parsed = useMemo(() => {
    if (!raw.trim()) return undefined;
    try {
      const sets = Teams.import(raw);
      if (!sets || sets.length === 0) {
        return {sets: [] as PokemonSet[], problems: ["That doesn't parse as a Showdown team export: check the format."]};
      }
      const problems = [...(validator.validateTeam(sets as never) ?? [])];
      // The validator only enforces a max of 6 (and a much lower singles min) —
      // require the full 6 so "Legal" always means a real, ready-to-run OU team.
      if (sets.length < 6) {
        problems.push(`A standard OU team needs 6 Pokémon (you have ${sets.length}).`);
      }
      return {sets: sets as unknown as PokemonSet[], problems};
    } catch {
      // @pkmn/sim can throw on sufficiently malformed input — treat as unparseable.
      return {sets: [] as PokemonSet[], problems: ["Couldn't read that team: check it's a valid Showdown export."]};
    }
  }, [raw, validator]);

  const valid = parsed && parsed.sets.length > 0 && parsed.problems.length === 0;

  return (
    <main className="screen">
      <h1>Test your team</h1>
      <p className="screen-sub">Paste a Gen 9 OU team. We validate as you type.</p>
      <PrivacyNote />
      <button type="button" className="load-sample" onClick={() => setRaw(EXAMPLE_TEAM)}>
        Load a sample team
      </button>
      <textarea
        className="team-input"
        value={raw}
        placeholder={PLACEHOLDER}
        onChange={event => setRaw(event.target.value)}
        rows={16}
        spellCheck={false}
      />
      {parsed && parsed.problems.length > 0 && (
        <ul className="problems" role="alert" aria-live="polite">
          {parsed.problems.map((problem, i) => (
            <li key={i}>{problem}</li>
          ))}
        </ul>
      )}
      {valid && parsed && (
        <>
          <p className="import-status">
            <span className="check">✓</span>
            Legal: {parsed.sets.length} Pokémon registered
          </p>
          <TeamPreviewRow species={parsed.sets.map(s => s.species)} />
        </>
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
