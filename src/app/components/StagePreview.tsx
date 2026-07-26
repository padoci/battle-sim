import {Sprites} from '@pkmn/img';
import {sceneUrl} from '../sixoh/scenes';

/**
 * A still of the battle stage, for the landing page.
 *
 * The landing page asked people to choose between two modes without showing
 * them what either looks like, while the most persuasive thing the app owns —
 * the Gen 5 battle stage — sat two clicks behind a draft. This puts it on the
 * page.
 *
 * It borrows the stage's own classes rather than a screenshot: it stays crisp
 * at any size, themes itself, costs one background and two sprites instead of
 * a large binary, and cannot drift from the real stage's styling. It is not
 * the real stage — no engine, no playback, no state — just the frame with two
 * mons standing in it, so nothing here can break a run.
 *
 * Decorative: `aria-hidden`, and the mode cards below are the real controls,
 * so this adds no duplicate tab stop and nothing for a screen reader to read.
 */

/** Gen 9 OU staples with static Gen 5-style sprites, so both idle-breathe. */
const THEIRS = 'Dragapult';
const MINE = 'Great Tusk';

function spriteUrl(species: string, back: boolean): string {
  return Sprites.getPokemon(species, back ? {gen: 'gen5', side: 'p1'} : {gen: 'gen5'}).url;
}

function StageMon({species, side}: {species: string; side: 'theirs' | 'mine'}) {
  return (
    <div className={`sprite-holder ${side}`}>
      {/* Same wrapper the stage uses, so the idle breath composes the same way
          — and stands down under reduced motion with everything else. */}
      <span className="sprite-idle breathing" style={{animationDelay: side === 'mine' ? '-1400ms' : '0ms'}}>
        <img className="stage-sprite" src={spriteUrl(species, side === 'mine')} alt="" />
      </span>
    </div>
  );
}

function StageHp({species, side, pct}: {species: string; side: 'theirs' | 'mine'; pct: number}) {
  // Mirrors the stage's own thresholds via the shared tokens.
  const fill = pct > 50 ? 'var(--hp-high)' : pct > 20 ? 'var(--hp-mid)' : 'var(--hp-low)';
  return (
    <div className={`hp-block ${side}`}>
      <div className="hp-head">
        <span className="hp-name">{species}</span>
        <span className="mono hp-level">Lv100</span>
      </div>
      <div className="hp-row">
        <span className="hp-hp mono">HP</span>
        <div className="hp-bar">
          <div className="hp-fill" style={{width: `${pct}%`, background: fill}} />
        </div>
      </div>
      {side === 'mine' ? (
        <span className="mono hp-numeric">341 / 404</span>
      ) : (
        <span className="mono hp-label">{pct}%</span>
      )}
    </div>
  );
}

export function StagePreview() {
  return (
    <div className="stage-preview" aria-hidden="true">
      <div className="battle-stage">
        <div className="stage-field">
          <div
            className="stage-world"
            style={{backgroundImage: `url(${sceneUrl('bg-meadow.png')})`}}
          >
            <span className="ground-shadow theirs" />
            <span className="ground-shadow mine" />
            <StageMon species={THEIRS} side="theirs" />
            <StageMon species={MINE} side="mine" />
          </div>
          <StageHp species={THEIRS} side="theirs" pct={38} />
          <StageHp species={MINE} side="mine" pct={84} />
        </div>
        <div className="message-box">Great Tusk used Headlong Rush!</div>
      </div>
    </div>
  );
}
