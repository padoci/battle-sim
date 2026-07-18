import {readFileSync} from 'node:fs';
import type {Page} from '@playwright/test';

/**
 * Serve the vendored fixtures for the data endpoints (data.pkmn.cc / the GitHub
 * mirror) and keep the external sample-teams fetch hermetic (empty index → the
 * built-in pool). Sprites are intentionally NOT mocked: in CI they load from
 * the real CDN, which is exactly the rendering the baselines capture.
 */
export async function routeData(page: Page): Promise<void> {
  await page.route(/https:\/\/(data\.pkmn\.cc|raw\.githubusercontent\.com).*\/(sets|stats|teams)\/gen9ou\.json/, route => {
    const kind = route.request().url().match(/(sets|stats|teams)\/gen9ou\.json/)![1];
    const file =
      kind === 'teams'
        ? 'test/fixtures/gen9ou.teams.full.json'
        : kind === 'sets'
          ? 'test/fixtures/gen9ou.sets.full.json'
          : 'test/fixtures/stats.fixture.json';
    route.fulfill({status: 200, contentType: 'application/json', body: readFileSync(file, 'utf8')});
  });
  await page.route(/crob\.at\/api\/samples\/gen9ou/, route =>
    route.fulfill({status: 200, contentType: 'application/json', body: '[]'})
  );
}

export const GOOD_TEAM = `Great Tusk @ Heavy-Duty Boots
Ability: Protosynthesis
Tera Type: Water
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Headlong Rush
- Ice Spinner
- Rapid Spin
- Knock Off

Kingambit @ Leftovers
Ability: Supreme Overlord
Tera Type: Ghost
EVs: 112 HP / 252 Atk / 144 Spe
Adamant Nature
- Swords Dance
- Kowtow Cleave
- Sucker Punch
- Iron Head

Dragapult @ Choice Specs
Ability: Infiltrator
Tera Type: Ghost
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Shadow Ball
- Draco Meteor
- Flamethrower
- U-turn

Gholdengo @ Air Balloon
Ability: Good as Gold
Tera Type: Fighting
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
- Make It Rain
- Shadow Ball
- Nasty Plot
- Recover

Gliscor @ Toxic Orb
Ability: Poison Heal
Tera Type: Water
EVs: 244 HP / 248 SpD / 16 Spe
Careful Nature
- Earthquake
- Knock Off
- Protect
- Spikes

Slowking-Galar @ Heavy-Duty Boots
Ability: Regenerator
Tera Type: Water
EVs: 248 HP / 8 Def / 252 SpD
Sassy Nature
IVs: 0 Atk / 0 Spe
- Chilly Reception
- Future Sight
- Sludge Bomb
- Thunder Wave
`;
