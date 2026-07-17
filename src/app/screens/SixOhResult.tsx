import {useMemo, useState} from 'react';
import {gen9} from '../../data/gen';
import {buildPostMortem} from '../../analysis/postmortem';
import type {DraftMode} from '../../draft/draft';
import {resetSixOhSession} from '../sixoh/session';
import {useSixOhDispatch, useSixOhState} from '../sixoh/state';

function Read({sentence, evidence}: {sentence: string; evidence: string[]}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pm-read">
      <p>{sentence}</p>
      {evidence.length > 0 && (
        <button className="pm-toggle mono" onClick={() => setOpen(o => !o)}>
          {open ? '▾ hide the calc' : '▸ show the calc'}
        </button>
      )}
      {open && (
        <ul className="pm-evidence mono">
          {evidence.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SixOhResult() {
  const state = useSixOhState();
  const dispatch = useSixOhDispatch();

  const postMortem = useMemo(() => {
    if (state.phase !== 'finished' || !state.team || !state.outcome) return undefined;
    const played = state.battles
      .map((battle, i) => ({opponentIndex: i, result: battle.result!}))
      .filter(b => b.result && state.battles[b.opponentIndex].phase === 'done');
    return buildPostMortem(gen9(), state.team, state.opponents, played, state.outcome);
  }, [state]);

  if (!postMortem || !state.outcome) {
    return (
      <main className="screen">
        <div className="empty-state">
          No finished run yet — <a href="#/sixoh">draft a team</a> and run the gauntlet.
        </div>
      </main>
    );
  }

  // Restart into a chosen difficulty. The mode rides in the hash query so the
  // draft screen picks it up on mount (preserving any dev params like seed).
  const restartAs = (mode: DraftMode) => {
    resetSixOhSession();
    dispatch({type: 'RESET'});
    const params = new URLSearchParams(location.hash.split('?')[1] ?? '');
    params.set('mode', mode);
    location.hash = `#/sixoh?${params.toString()}`;
  };

  return (
    <main className="arena result-screen">
      <div className={`result-card ${state.outcome}`}>
        <div className="mono result-record">{postMortem.record}</div>
        <h1>{postMortem.headline}</h1>
        {state.outcome === 'flawless' && <p className="flawless-sub">Every rung. No losses. Go touch grass, champion.</p>}

        <section className="post-mortem">
          <h3>Post-mortem</h3>
          {postMortem.reads.length === 0 && <p className="hint">Clean sweep — nothing to autopsy.</p>}
          {postMortem.reads.map((read, i) => (
            <Read key={i} sentence={read.sentence} evidence={read.evidence} />
          ))}
        </section>

        <div className="result-actions">
          <button className="primary" onClick={() => restartAs(state.mode)}>
            Draft again
          </button>
          {state.mode === 'easy' && <button onClick={() => restartAs('normal')}>Step up to Normal</button>}
          {state.mode === 'normal' && <button onClick={() => restartAs('hard')}>Step up to Hard</button>}
        </div>
      </div>
    </main>
  );
}
