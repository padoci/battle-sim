import {describe, expect, it} from 'vitest';
import {createBattle, makeJointChoice} from '../../src/engine/battle';
import {seedFromInts} from '../../src/engine/rng';
import {parseProtocol} from '../../src/replay/parse';
import {toBeats} from '../../src/replay/pace';
import {applyBeat, initView, type FxItem, type ViewState} from '../../src/replay/view';
import {makeSet} from '../engine/helpers';

/**
 * Pain Split is the only move in gen9 that reports HP through `-sethp` rather
 * than `-damage`/`-heal`, and `-sethp` used to fall through to the parser's
 * default branch — so the move animated, but neither HP bar moved and no
 * damage number floated. The target's bar stayed wrong indefinitely; the
 * user's silently snapped later, whenever the next `-damage` line happened to
 * carry an absolute HP that corrected it.
 *
 * The gate is a live scripted battle checked against the sim's own HP, not a
 * frozen fixture: the assertion that catches the regression is "the view
 * mirrors the sim", and only the sim can state the right answer.
 */

/** Blissey runs Ice Beam so it can chip the Ghost before the split, giving the
 *  two HP totals something to average. Neither side holds Leftovers or heals,
 *  so nothing but Pain Split touches HP on the split turn. */
const P1 = [makeSet('Gengar', ['Pain Split', 'Shadow Ball'], {ability: 'Cursed Body', item: ''})];
const P2 = [makeSet('Blissey', ['Ice Beam', 'Soft-Boiled'], {ability: 'Natural Cure', item: ''})];

/** Chip Gengar on turn 1, Pain Split on turn 2. Returns the battle plus the
 *  view state folded from its protocol log, and every FX raised on the way. */
function painSplitBattle() {
  const battle = createBattle({p1: {team: P1}, p2: {team: P2}, seed: seedFromInts(1, 2, 3, 4)});
  makeJointChoice(battle, 'move 2', 'move 1'); // Shadow Ball (immune) / Ice Beam
  makeJointChoice(battle, 'move 1', 'move 1'); // Pain Split / Ice Beam

  const events = parseProtocol(battle.log, ['P1', 'P2']);
  const beats = toBeats(events);
  let view: ViewState = initView([P1, P2]);
  const fx: FxItem[] = [];
  for (const beat of beats) {
    const applied = applyBeat(view, beat);
    view = applied.state;
    fx.push(...applied.fx);
  }
  return {battle, events, beats, view, fx};
}

describe('pain split (-sethp)', () => {
  it('moves both HP bars to the values the sim actually holds', () => {
    const {battle, view} = painSplitBattle();
    const sim = [battle.sides[0].active[0]!, battle.sides[1].active[0]!] as const;

    // Sanity: the scripted battle really did split unequal HP totals, so this
    // gate cannot pass by both sides trivially sitting at full.
    expect(sim[1].hp).toBeLessThan(sim[1].maxhp);

    for (const side of [0, 1] as const) {
      expect(view.sides[side].mons[0].hp).toBe(sim[side].hp);
      expect(view.sides[side].mons[0].maxhp).toBe(sim[side].maxhp);
    }
  });

  it('floats an HP number on the side that lost HP', () => {
    const {fx} = painSplitBattle();
    // Blissey (side 1) drops to the average; the float is what makes an
    // otherwise-invisible 245 HP swing readable.
    const drops = fx.filter(f => f.type === 'float' && f.side === 1 && f.text?.startsWith('−'));
    expect(drops.length).toBeGreaterThan(0);
  });

  it('says something in the battle log', () => {
    const {view} = painSplitBattle();
    expect(view.logLines).toContain('P1 Gengar used Pain Split!');
    expect(view.logLines).toContain('The battlers shared their pain!');
  });

  it('keeps the signature animation on the target', () => {
    const {fx} = painSplitBattle();
    // The bespoke `.fx-signature-pain-split.impact::after` rule needs an
    // impact FX carrying the move name, on the defender's side.
    expect(fx).toEqual(
      expect.arrayContaining([expect.objectContaining({type: 'impact', side: 1, move: 'Pain Split'})])
    );
  });

  it('reads the split as one beat with the move that caused it', () => {
    const {beats} = painSplitBattle();
    const beat = beats.find(b => b.events.some(e => e.kind === 'move' && e.move === 'Pain Split'));
    expect(beat).toBeDefined();
    // Both halves ride the move's own beat, so the lunge and the two bars
    // drain together instead of trailing it as separate pauses.
    expect(beat!.events.filter(e => e.kind === 'sethp')).toHaveLength(2);
  });
});
