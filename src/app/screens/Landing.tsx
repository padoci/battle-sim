import {navigate} from '../router';

export function Landing() {
  return (
    <main className="landing">
      <h1 className="hero">Build the team. We'll pressure-test it.</h1>
      <p className="hero-sub">
        AI-vs-AI Gen 9 OU simulation, in your browser. Direction, not gospel.
      </p>
      <div className="mode-cards">
        <button className="mode-card" onClick={() => navigate('sixoh-draft')}>
          <h2>Can you 6-0?</h2>
          <p>Draft a team from random picks, then send it through a six-battle gauntlet. Win all six to go flawless.</p>
        </button>
        <button className="mode-card" onClick={() => navigate('test-import')}>
          <h2>Test your team</h2>
          <p>Paste a team and see its best and worst matchups — with a game plan for each.</p>
        </button>
      </div>
    </main>
  );
}
