import {Sprites} from '@pkmn/img';
import {sceneUrl} from '../sixoh/scenes';
import {useLandingReel, type ReelMon} from './useLandingReel';

/**
 * The battle stage on the landing page, replaying a real battle.
 *
 * The landing page asked people to choose between two modes without showing
 * them what either looks like, while the most persuasive thing the app owns —
 * the Gen 5 battle stage — sat two clicks behind a draft. This puts it on the
 * page, and plays an actual 30-turn battle through it at the same pace the
 * gauntlet uses, looping.
 *
 * It borrows the stage's own classes rather than a screenshot or a video: it
 * stays crisp at any size, themes itself, costs one background and two sprites
 * instead of a large binary, and cannot drift from the real stage's styling.
 * There is still no engine and no worker here — `useLandingReel` steps a
 * vendored protocol log, so nothing on this page can break a run, and the
 * first paint pulls no data.
 *
 * Under reduced motion it holds the poster frame and loads nothing at all.
 *
 * Decorative: `aria-hidden`, and the mode cards below are the real controls,
 * so this adds no duplicate tab stop and nothing for a screen reader to read.
 */

function spriteUrl(species: string, back: boolean): string {
  return Sprites.getPokemon(species, back ? {gen: 'gen5', side: 'p1'} : {gen: 'gen5'}).url;
}

function StageMon({species, side, fainted}: {species: string; side: 'theirs' | 'mine'; fainted: boolean}) {
  return (
    <div className={`sprite-holder ${side}`}>
      {/* Same wrapper the stage uses, so the idle breath composes the same way
          — and stands down under reduced motion with everything else.
          Keyed on species so swapping mons restarts the sprite cleanly rather
          than cross-fading one image into another. */}
      <span
        className="sprite-idle breathing"
        style={{
          animationDelay: side === 'mine' ? '-1400ms' : '0ms',
          // A fainted mon drops out until its replacement switches in.
          opacity: fainted ? 0 : 1,
          transition: 'opacity 220ms ease-out',
        }}
      >
        <img key={species} className="stage-sprite" src={spriteUrl(species, side === 'mine')} alt="" />
      </span>
    </div>
  );
}

function StageHp({mon, side}: {mon: ReelMon; side: 'theirs' | 'mine'}) {
  const {species} = mon;
  const pct = mon.maxhp > 0 ? Math.max(0, Math.round((mon.hp / mon.maxhp) * 100)) : 0;
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
          <div
            className="hp-fill"
            // Animating width is what makes a hit read as a hit rather than a
            // jump cut; the stage itself does the same.
            style={{width: `${pct}%`, background: fill, transition: 'width 320ms ease-out'}}
          />
        </div>
      </div>
      {side === 'mine' ? (
        <span className="mono hp-numeric">{Math.max(0, mon.hp)} / {mon.maxhp}</span>
      ) : (
        <span className="mono hp-label">{pct}%</span>
      )}
    </div>
  );
}

export function StagePreview() {
  const frame = useLandingReel();
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
            <StageMon species={frame.theirs.species} side="theirs" fainted={frame.theirs.hp <= 0} />
            <StageMon species={frame.mine.species} side="mine" fainted={frame.mine.hp <= 0} />
          </div>
          <StageHp mon={frame.theirs} side="theirs" />
          <StageHp mon={frame.mine} side="mine" />
        </div>
        <div className="message-box">{frame.message}</div>
      </div>
    </div>
  );
}
