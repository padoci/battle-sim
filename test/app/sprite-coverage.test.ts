/**
 * Does every Pokemon the app can put on the field actually have art?
 *
 * `SpriteWithFallback` in SixOhGauntlet walks gen5ani -> gen5 -> icon. The last
 * rung is the one that matters here: if `Icons.getPokemon` does not know a
 * species it returns the sheet's 0,0 cell, so the fallback renders a blank box
 * rather than throwing. Nothing in the suite noticed a species that art-resolves
 * to nothing, because nothing enumerated the species at all.
 *
 * This is a pure-computation gate: @pkmn/img derives URLs and sheet offsets from
 * the name, so it runs offline and proves the *app's* resolution, not the CDN's
 * inventory. Whether a URL 200s is a network question and deliberately out of
 * scope; see scripts/check-sprite-cdn.mjs for that sweep.
 */
import {describe, expect, it} from 'vitest';
import {Icons, Sprites} from '@pkmn/img';
import type {SetsData, Team} from '../../src/data/types';
import gymLeaderTeamsJson from '../../src/data/gym-leader-teams.gen9ou.json';
import minedTeamsJson from '../../src/data/mined-teams.gen9ou.json';
import vendoredTeamsJson from '../../src/data/vendored-teams.gen9ou.json';
import fullSets from '../fixtures/gen9ou.sets.full.json';
import fullTeams from '../fixtures/gen9ou.teams.full.json';

const speciesOfTeams = (teams: Team[]): string[] =>
  teams.flatMap(t => t.data.map(m => m.species)).filter((s): s is string => !!s);

const PACKS: Array<{name: string; species: string[]}> = [
  {name: 'vendored-teams', species: speciesOfTeams(vendoredTeamsJson as unknown as Team[])},
  {name: 'mined-teams', species: speciesOfTeams(minedTeamsJson as unknown as Team[])},
  {name: 'gym-leader-teams', species: speciesOfTeams(gymLeaderTeamsJson as unknown as Team[])},
  {name: 'sets fixture', species: Object.keys(fullSets as SetsData)},
  {name: 'teams fixture', species: speciesOfTeams(fullTeams as Team[])},
];

const ALL = [...new Set(PACKS.flatMap(p => p.species))].sort();

/** The 0,0 cell of the icon sheet: what @pkmn/img returns for a name it cannot place. */
function iconOffset(species: string): string {
  const match = /scroll (-?\d+px) (-?\d+px)/.exec(Icons.getPokemon(species).style);
  return match ? `${match[1]},${match[2]}` : 'NO-OFFSET';
}
const MISSING_ICON = '0px,0px';

/** `.../gen5/0.png` is the substitute sprite for an unknown species. */
const isPlaceholderSprite = (url: string) => /\/0\.png$/.test(url);

/**
 * The three packs that ship in the bundle, plus the two fixtures standing in for
 * the endpoints fetched at runtime. Species that appear only in a live /teams
 * response and in neither fixture are outside this gate by construction.
 */
describe('sprite coverage across every shipped pack', () => {
  it('extracts species from every pack (guards against a silent shape change)', () => {
    const empty = PACKS.filter(p => p.species.length === 0).map(p => p.name);
    expect(empty, 'these packs yielded no species at all, so the shape changed').toEqual([]);
    for (const pack of PACKS) {
      // The teams fixture is a 10-team snapshot, so its floor is lower than the
      // shipped packs' - still far above what a half-read pack would yield.
      const floor = pack.name === 'teams fixture' ? 10 : 20;
      expect(pack.species.length, `${pack.name} yielded suspiciously few species`).toBeGreaterThan(floor);
    }
    expect(ALL.length).toBeGreaterThan(100);
  });

  it('the icon terminal fallback resolves for every species', () => {
    const blank = ALL.filter(s => iconOffset(s) === MISSING_ICON);
    expect(
      blank,
      `these species fall through to the icon tier and land on the sheet's empty 0,0 ` +
        `cell, so the battle stage would show a blank box: ${blank.join(', ')}`
    ).toEqual([]);

    // The probe can report failure: a name @pkmn/img cannot place must come back 0,0.
    expect(iconOffset('Definitely Not A Pokemon')).toBe(MISSING_ICON);
  });

  it('the static gen5 tier resolves for every species, both facings', () => {
    const bad: string[] = [];
    for (const species of ALL) {
      const front = Sprites.getPokemon(species, {gen: 'gen5'}).url;
      const back = Sprites.getPokemon(species, {gen: 'gen5', side: 'p1'}).url;
      if (isPlaceholderSprite(front)) bad.push(`${species} (front)`);
      if (isPlaceholderSprite(back)) bad.push(`${species} (back)`);
    }
    expect(
      bad,
      `these resolve to the gen5 substitute sprite (0.png) instead of their own art: ${bad.join(', ')}`
    ).toEqual([]);

    expect(isPlaceholderSprite(Sprites.getPokemon('Definitely Not A Pokemon', {gen: 'gen5'}).url)).toBe(true);
  });

  it('reports how much of the field actually animates', () => {
    // Mirrors SpriteWithFallback's own rule: the tier is decided by the asset,
    // not the request, because asking for gen5ani on a species without one
    // returns a static .png.
    const animated = ALL.filter(s => Sprites.getPokemon(s, {gen: 'gen5ani'}).url.endsWith('.gif'));
    const still = ALL.filter(s => !Sprites.getPokemon(s, {gen: 'gen5ani'}).url.endsWith('.gif'));
    const pct = Math.round((animated.length / ALL.length) * 100);
    console.log(
      `\nsprite coverage across ${ALL.length} distinct species` +
        `\n  icon fallback resolves : ${ALL.length}/${ALL.length}` +
        `\n  gen5 static resolves   : ${ALL.length}/${ALL.length} (both facings)` +
        `\n  animated gen5ani       : ${animated.length}/${ALL.length} (${pct}%)` +
        `\n  static only (breathes) : ${still.length}/${ALL.length}` +
        `\n  per pack               : ` +
        PACKS.map(p => `${p.name} ${new Set(p.species).size}`).join(', ') +
        `\n`
    );
    // Not a quality bar - upstream owns gen5ani inventory, so this deliberately
    // does NOT pin the exact number. It only catches a collapse: if a @pkmn/img
    // bump or a naming change dropped most species off the animated tier, the
    // breathing path would silently become the norm again, which is the thing the
    // comment in SpriteWithFallback used to get wrong. The printed split above is
    // the real artefact - read it in CI output when the packs change.
    expect(pct, 'animated coverage collapsed; re-read the split above').toBeGreaterThan(50);
  });
});
