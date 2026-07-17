/**
 * Build the vendored sample-teams pack: `src/data/vendored-teams.gen9ou.json`.
 *
 *   npx vite-node scripts/build-sample-teams.ts            # seed only (offline)
 *   npx vite-node scripts/build-sample-teams.ts --fetch    # + fetch crob.at (CI/online)
 *
 * Why vendored instead of a runtime fetch: crob.at is CORS-blocked in the
 * browser, so the old runtime fetch never populated the pool. Fetching
 * server-side (here / in CI) and shipping a static JSON has no CORS, no hang,
 * and is fully testable. Every team is validated as gen9ou before it's kept;
 * the fetch layer only ever ADDS to the hand-curated seed (a failed fetch can
 * never shrink the pack).
 */
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {Teams, TeamValidator} from '@pkmn/sim';
import {MemoryStore} from '../src/data/cache';
import {fetchSampleTeams, mergeTeams} from '../src/data/sampleTeams';
import {setToTeamMember} from '../src/data/team';
import type {PokemonSet, Team} from '../src/data/types';

const OUT = 'src/data/vendored-teams.gen9ou.json';

/**
 * Hand-curated real Gen 9 OU teams (validated below). This is the reliable
 * floor — the pool grows past the built-in 10 even if the fetch source is dead.
 */
const SEED: Array<{name: string; export: string}> = [
  {
    name: 'Gholdengo Balance',
    export: `Great Tusk @ Heavy-Duty Boots
Ability: Protosynthesis
Tera Type: Water
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Headlong Rush
- Ice Spinner
- Rapid Spin
- Knock Off

Gholdengo @ Choice Scarf
Ability: Good as Gold
Tera Type: Steel
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Make It Rain
- Shadow Ball
- Focus Blast
- Trick

Slowking-Galar @ Heavy-Duty Boots
Ability: Regenerator
Tera Type: Water
EVs: 252 HP / 16 Def / 240 SpD
Sassy Nature
IVs: 0 Atk / 0 Spe
- Future Sight
- Chilly Reception
- Sludge Bomb
- Thunder Wave

Kingambit @ Leftovers
Ability: Supreme Overlord
Tera Type: Fire
EVs: 236 HP / 252 Atk / 20 Spe
Adamant Nature
- Swords Dance
- Kowtow Cleave
- Sucker Punch
- Iron Head

Ting-Lu @ Leftovers
Ability: Vessel of Ruin
Tera Type: Water
EVs: 252 HP / 4 Def / 252 SpD
Careful Nature
- Earthquake
- Ruination
- Whirlwind
- Stealth Rock

Dragapult @ Choice Specs
Ability: Infiltrator
Tera Type: Ghost
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Shadow Ball
- Draco Meteor
- Flamethrower
- U-turn`,
  },
  {
    name: 'Gliscor Stall-ish',
    export: `Gliscor @ Toxic Orb
Ability: Poison Heal
Tera Type: Water
EVs: 244 HP / 248 Def / 16 Spe
Impish Nature
- Earthquake
- Knock Off
- Protect
- Spikes

Dondozo @ Heavy-Duty Boots
Ability: Unaware
Tera Type: Fairy
EVs: 252 HP / 4 Atk / 252 Def
Impish Nature
- Wave Crash
- Body Press
- Rest
- Sleep Talk

Clodsire @ Heavy-Duty Boots
Ability: Water Absorb
Tera Type: Steel
EVs: 252 HP / 4 Def / 252 SpD
Careful Nature
- Earthquake
- Toxic
- Recover
- Stealth Rock

Corviknight @ Leftovers
Ability: Pressure
Tera Type: Dragon
EVs: 252 HP / 4 Atk / 252 Def
Impish Nature
- Body Press
- Brave Bird
- Roost
- Defog

Gholdengo @ Leftovers
Ability: Good as Gold
Tera Type: Flying
EVs: 252 HP / 4 SpA / 252 SpD
Calm Nature
- Make It Rain
- Shadow Ball
- Recover
- Nasty Plot

Slowking-Galar @ Heavy-Duty Boots
Ability: Regenerator
Tera Type: Water
EVs: 252 HP / 16 Def / 240 SpD
Sassy Nature
IVs: 0 Atk / 0 Spe
- Future Sight
- Chilly Reception
- Sludge Bomb
- Thunder Wave`,
  },
  {
    name: 'Rain Offense',
    export: `Pelipper @ Damp Rock
Ability: Drizzle
Tera Type: Ground
EVs: 248 HP / 252 Def / 8 SpA
Bold Nature
- Hurricane
- Surf
- U-turn
- Roost

Barraskewda @ Choice Band
Ability: Swift Swim
Tera Type: Water
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Liquidation
- Close Combat
- Flip Turn
- Aqua Jet

Zapdos @ Heavy-Duty Boots
Ability: Static
Tera Type: Electric
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Hurricane
- Thunder
- Volt Switch
- Roost

Great Tusk @ Heavy-Duty Boots
Ability: Protosynthesis
Tera Type: Water
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Headlong Rush
- Ice Spinner
- Rapid Spin
- Knock Off

Kingambit @ Black Glasses
Ability: Supreme Overlord
Tera Type: Dark
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Swords Dance
- Kowtow Cleave
- Sucker Punch
- Iron Head

Ogerpon @ Heavy-Duty Boots
Ability: Defiant
Tera Type: Grass
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Ivy Cudgel
- Power Whip
- Knock Off
- U-turn`,
  },
];

const asPokemonSets = (t: unknown): PokemonSet[] | null => t as unknown as PokemonSet[] | null;

function main() {
  const validator = new TeamValidator('gen9ou');
  const seedTeams: Team[] = [];
  for (const cand of SEED) {
    const sets = asPokemonSets(Teams.import(cand.export));
    if (!sets || sets.length !== 6) {
      console.warn(`SKIP "${cand.name}": did not import as 6 mons`);
      continue;
    }
    const problems = validator.validateTeam(sets as never);
    if (problems && problems.length) {
      console.warn(`SKIP "${cand.name}": ${problems.join('; ')}`);
      continue;
    }
    seedTeams.push({name: cand.name, author: 'curated', data: sets.map(setToTeamMember)});
    console.log(`ok  "${cand.name}" (${sets.map(s => s.species).join(', ')})`);
  }

  // Never shrink below what's already vendored; add the seed + any fetched.
  const existing: Team[] = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as Team[]) : [];

  const run = async () => {
    let fetched: Team[] = [];
    if (process.argv.includes('--fetch')) {
      console.log('fetching crob.at sample teams (server-side)…');
      try {
        fetched = await fetchSampleTeams({store: new MemoryStore(), fetchFn: fetch, timeoutMs: 20000});
        console.log(`fetched ${fetched.length} team(s) from the source`);
      } catch (e) {
        console.warn(`fetch failed (keeping seed only): ${String(e)}`);
      }
    }
    const merged = mergeTeams(existing, seedTeams, fetched);
    writeFileSync(OUT, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`wrote ${OUT} with ${merged.length} team(s)`);
  };
  return run();
}

main();
