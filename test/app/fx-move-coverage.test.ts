/**
 * Does every move the app can actually show have an animation?
 *
 * The existing FX gates check the *internal* joins: test/app/fx-signature-css.test.ts
 * asserts the TypeScript list and the app.css rules agree, and
 * test/visual/fx.spec.ts asserts each class reaches the rendered style. Neither
 * looks at the battle data, so a new opponent pack can introduce a move that no
 * sweep ever animated and nothing fails. That is exactly what happened: the
 * gym-leader pack (scripts/build-gym-leader-teams.ts, added after the signature
 * batches) brought in four moves that never got a bespoke shape.
 *
 * "Has an animation" has two tiers, and this file only gates the second:
 *   1. EVERY move animates. SixOhGauntlet composes `fx-<category>` (the motion)
 *      and `fx-move-<type>` (the colour) for any move with a category and a
 *      type, so there is no such thing as a move that renders nothing.
 *   2. Curated moves additionally get `fx-signature-<slug>`, a bespoke shape.
 * So a miss here is "renders the generic typed animation instead of its own
 * shape", not "renders nothing".
 */
import {describe, expect, it} from 'vitest';
import {SIGNATURE_MOVES, signatureSlug} from '../../src/app/sixoh/fx';
import type {SetsData, Team} from '../../src/data/types';
import gymLeaderTeamsJson from '../../src/data/gym-leader-teams.gen9ou.json';
import minedTeamsJson from '../../src/data/mined-teams.gen9ou.json';
import vendoredTeamsJson from '../../src/data/vendored-teams.gen9ou.json';
import fullSets from '../fixtures/gen9ou.sets.full.json';
import fullTeams from '../fixtures/gen9ou.teams.full.json';

/**
 * Moves in the data with no bespoke shape, and why each is still open. Tracked
 * rather than silenced: every one animates via the generic layer today, and
 * drawing a new keyframe set is a visual-design decision, not a mechanical fix.
 *
 * This map is the entire editorial surface of this gate. Shrink it by adding
 * CSS; never grow it to quiet a failure without a reason worth writing down.
 * Delete an entry when its shape lands - the assertions below fail if an entry
 * goes stale in either direction.
 */
const AWAITING_A_BESPOKE_SHAPE = new Map<string, string>([
  ['Psycho Cut', 'gym-leader pack, added after the signature batches; a physical Psychic slash'],
  ['Tail Slap', 'gym-leader pack; multi-hit physical, so the shape has to survive repeats'],
  ['Heat Crash', 'gym-leader pack; weight-based physical Fire contact hit'],
  ['Double Hit', 'gym-leader pack; two-strike physical, same repeat problem as Tail Slap'],
  [
    'Tera Blast',
    'teams pool only. Its type varies at runtime with the holder\'s Tera type, but ' +
      "`fxFlavor` colours FX from the DEX type (src/replay/view.ts reads " +
      '`gen9().moves.get(move).type`), so it always renders Normal-coloured no matter ' +
      'what it actually became. A bespoke shape is drawable - the shape and the colour ' +
      'are separate layers - but deciding what it should look like when the element is ' +
      'unknowable is the judgement call, hence open rather than exempt.',
  ],
]);

/** Every move on a team pack, flattening the "slashed alternatives" arrays. */
function movesOfTeams(teams: Team[]): Set<string> {
  const out = new Set<string>();
  for (const team of teams) {
    for (const member of team.data) {
      for (const slot of member.moves ?? []) {
        for (const option of Array.isArray(slot) ? slot : [slot]) {
          if (option) out.add(option);
        }
      }
    }
  }
  return out;
}

function movesOfSets(sets: SetsData): Set<string> {
  const out = new Set<string>();
  for (const byName of Object.values(sets)) {
    for (const set of Object.values(byName)) {
      for (const slot of set.moves ?? []) {
        for (const option of Array.isArray(slot) ? slot : [slot]) {
          if (option) out.add(option);
        }
      }
    }
  }
  return out;
}

/**
 * The three packs that ship in the bundle, plus the two fixtures standing in
 * for the endpoints the app fetches at runtime (/sets and /teams). The fixtures
 * are snapshots, so a move that appears live and in neither fixture is outside
 * this gate by construction - the sets fixture currently matches live exactly on
 * species (108) and differs by one move, so the snapshot is not drifting.
 */
const PACKS: Array<{name: string; moves: Set<string>}> = [
  {name: 'vendored-teams', moves: movesOfTeams(vendoredTeamsJson as unknown as Team[])},
  {name: 'mined-teams', moves: movesOfTeams(minedTeamsJson as unknown as Team[])},
  {name: 'gym-leader-teams', moves: movesOfTeams(gymLeaderTeamsJson as unknown as Team[])},
  {name: 'sets fixture', moves: movesOfSets(fullSets as SetsData)},
  {name: 'teams fixture', moves: movesOfTeams(fullTeams as Team[])},
];

describe('bespoke FX coverage vs the shipped battle data', () => {
  /**
   * The load-bearing guard. Every assertion below is only as good as the
   * extraction, and these five sources have five different provenances - if a
   * future shape change made `member.moves` land somewhere else, the coverage
   * assertion would read an empty set and pass while checking nothing.
   */
  it('extracts moves from every pack (guards against a silent shape change)', () => {
    const empty = PACKS.filter(p => p.moves.size === 0).map(p => p.name);
    expect(empty, `these packs yielded no moves at all, so the shape changed`).toEqual([]);
    for (const pack of PACKS) {
      // Loose floors: a real pack has dozens of distinct moves, an
      // accidentally-half-read one has a handful.
      expect(pack.moves.size, `${pack.name} yielded suspiciously few moves`).toBeGreaterThan(20);
    }
  });

  it('every move in the gated data has a bespoke shape, or a documented reason not to', () => {
    const all = new Set(PACKS.flatMap(p => [...p.moves]));
    const missing = [...all]
      .filter(move => !signatureSlug(move))
      .filter(move => !AWAITING_A_BESPOKE_SHAPE.has(move))
      .sort();

    expect(
      missing,
      `these moves appear in the gated battle data but have no fx-signature-* shape. ` +
        `Either add one to SIGNATURE_MOVES + app.css, or record it in ` +
        `AWAITING_A_BESPOKE_SHAPE with the reason it is still open: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('reports coverage per pack, and keeps the tracked-gap list honest', () => {
    const all = new Set(PACKS.flatMap(p => [...p.moves]));
    const bespoke = [...all].filter(m => signatureSlug(m));
    const lines = PACKS.map(p => {
      const covered = [...p.moves].filter(m => signatureSlug(m)).length;
      return `  ${p.name.padEnd(18)} ${covered}/${p.moves.size} bespoke`;
    });
    console.log(
      `\nbespoke FX coverage\n${lines.join('\n')}\n` +
        `  ${'ALL GATED DATA'.padEnd(18)} ${bespoke.length}/${all.size} bespoke ` +
        `(${AWAITING_A_BESPOKE_SHAPE.size} awaiting a shape)\n` +
        `  SIGNATURE_MOVES holds ${SIGNATURE_MOVES.size} moves in total\n`
    );

    // A tracked gap for a move no longer in the data is dead weight, and one for a
    // move that HAS a shape is a contradiction. Both would quietly outlive their
    // reason, so each entry has to keep earning its place.
    for (const [move, why] of AWAITING_A_BESPOKE_SHAPE) {
      expect(why.length, `${move} needs a real reason, not a placeholder`).toBeGreaterThan(20);
      expect(
        signatureSlug(move),
        `${move} now has a bespoke shape - drop it from AWAITING_A_BESPOKE_SHAPE`
      ).toBeUndefined();
      expect(
        [...all].includes(move),
        `${move} is tracked as a gap but no longer appears in any gated source`
      ).toBe(true);
    }
  });
});
