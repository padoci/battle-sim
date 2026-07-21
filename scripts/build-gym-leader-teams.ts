/**
 * Build the Gym Leader mode opponent pack: `src/data/gym-leader-teams.gen9ou.json`.
 *
 *   npx vite-node scripts/build-gym-leader-teams.ts
 *
 * Real trainers' full 6-Pokémon rosters (the expanded "rematch" teams video
 * games have actually shipped - Black 2/White 2's Pokémon World Tournament,
 * Scarlet/Violet's Indigo Disk League Club - not their much smaller in-story
 * teams), given Smogon-style sets (not necessarily meta-relevant - some of
 * these species are firmly non-OU - but legal, and true to the trainer's
 * signature type). A number of the trainers' real roster members aren't
 * legal in this project's pinned gen9ou data (marked "Past"/not yet
 * Home-transferable, or Ubers) - those slots are filled with a same-type
 * substitute instead, noted inline. Every team is validated as gen9ou before
 * it's kept, same as build-sample-teams.ts.
 */
import {writeFileSync} from 'node:fs';
import {Teams, TeamValidator} from '@pkmn/sim';
import {setToTeamMember} from '../src/data/team';
import type {PokemonSet} from '../src/data/types';

const OUT = 'src/data/gym-leader-teams.gen9ou.json';

export interface GymLeaderEntry {
  name: string;
  signatureType: string;
  isChampion: boolean;
  export: string;
}

const LEADERS: GymLeaderEntry[] = [
  {
    name: 'Brock',
    signatureType: 'Rock',
    isChampion: false,
    // Onix/Kabutops/Omastar/Aerodactyl/Relicanth aren't legal here - filled
    // out with other real Rock-types instead.
    export: `Golem @ Custap Berry
Ability: Sturdy
Tera Type: Rock
EVs: 252 HP / 252 Atk / 4 Def
Adamant Nature
- Stealth Rock
- Earthquake
- Stone Edge
- Explosion

Rampardos @ Choice Band
Ability: Mold Breaker
Tera Type: Rock
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Head Smash
- Earthquake
- Fire Punch
- Zen Headbutt

Probopass @ Leftovers
Ability: Sturdy
Tera Type: Steel
EVs: 252 HP / 4 SpA / 252 SpD
Sassy Nature
- Stealth Rock
- Volt Switch
- Flash Cannon
- Toxic

Sudowoodo @ Leftovers
Ability: Rock Head
Tera Type: Rock
EVs: 252 HP / 252 Atk / 4 Def
Adamant Nature
- Stealth Rock
- Wood Hammer
- Earthquake
- Head Smash

Coalossal @ Leftovers
Ability: Flame Body
Tera Type: Rock
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
- Stealth Rock
- Rock Slide
- Flamethrower
- Body Press

Stonjourner @ Choice Band
Ability: Power Spot
Tera Type: Rock
EVs: 252 HP / 252 Atk / 4 Def
Adamant Nature
- Heat Crash
- Earthquake
- Stone Edge
- Curse`,
  },
  {
    name: 'Misty',
    signatureType: 'Water',
    isChampion: false,
    // Starmie/Seaking aren't legal here - filled out with other Water-types.
    export: `Golduck @ Choice Specs
Ability: Swift Swim
Tera Type: Water
EVs: 4 Def / 252 SpA / 252 Spe
Modest Nature
- Hydro Pump
- Ice Beam
- Psychic
- Flip Turn

Lapras @ Leftovers
Ability: Water Absorb
Tera Type: Ice
EVs: 252 HP / 4 Def / 252 SpD
Calm Nature
- Surf
- Freeze-Dry
- Perish Song
- Protect

Slowbro @ Heavy-Duty Boots
Ability: Regenerator
Tera Type: Water
EVs: 252 HP / 252 Def / 4 SpD
Calm Nature
- Scald
- Slack Off
- Teleport
- Fire Blast

Blastoise @ Leftovers
Ability: Torrent
Tera Type: Water
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
- Scald
- Rapid Spin
- Ice Beam
- Roar

Primarina @ Leftovers
Ability: Torrent
Tera Type: Fairy
EVs: 252 HP / 252 SpA / 4 SpD
Modest Nature
- Moonblast
- Scald
- Calm Mind
- Flip Turn

Politoed @ Choice Specs
Ability: Drizzle
Tera Type: Water
EVs: 4 Def / 252 SpA / 252 Spe
Modest Nature
- Hydro Pump
- Ice Beam
- Focus Blast
- Toxic`,
  },
  {
    name: 'Erika',
    signatureType: 'Grass',
    isChampion: false,
    // Tangrowth isn't legal here - Amoonguss stands in. Sleep Powder is
    // banned by this format's Sleep Moves Clause on every set.
    export: `Vileplume @ Black Sludge
Ability: Effect Spore
Tera Type: Fairy
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
- Giga Drain
- Sludge Bomb
- Moonlight
- Stun Spore

Venusaur @ Leftovers
Ability: Chlorophyll
Tera Type: Water
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
- Giga Drain
- Sludge Bomb
- Leech Seed
- Synthesis

Victreebel @ Choice Band
Ability: Chlorophyll
Tera Type: Grass
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Power Whip
- Sucker Punch
- Knock Off
- Poison Jab

Exeggutor @ Heavy-Duty Boots
Ability: Harvest
Tera Type: Psychic
EVs: 252 HP / 252 SpA / 4 SpD
Modest Nature
- Giga Drain
- Psychic
- Toxic
- Leech Seed

Amoonguss @ Assault Vest
Ability: Regenerator
Tera Type: Water
EVs: 252 HP / 4 Def / 252 SpD
Calm Nature
- Giga Drain
- Sludge Bomb
- Clear Smog
- Toxic

Bellossom @ Leftovers
Ability: Chlorophyll
Tera Type: Fairy
EVs: 252 HP / 4 Def / 252 SpD
Bold Nature
- Giga Drain
- Leaf Storm
- Quiver Dance
- Strength Sap`,
  },
  {
    name: 'Sabrina',
    signatureType: 'Psychic',
    isChampion: false,
    // Alakazam/Mr. Mime/Jynx aren't legal here - filled out with other
    // Psychic-types.
    export: `Gardevoir @ Choice Specs
Ability: Trace
Tera Type: Fairy
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Psychic
- Moonblast
- Shadow Ball
- Trick

Hypno @ Assault Vest
Ability: Insomnia
Tera Type: Fairy
EVs: 252 HP / 4 Def / 252 SpD
Careful Nature
- Psychic
- Fire Punch
- Ice Punch
- Thunder Punch

Farigiraf @ Assault Vest
Ability: Armor Tail
Tera Type: Psychic
EVs: 252 HP / 4 SpA / 252 SpD
Sassy Nature
- Psychic
- Hyper Voice
- Thunderbolt
- Trick Room

Slowking @ Heavy-Duty Boots
Ability: Regenerator
Tera Type: Water
EVs: 252 HP / 4 Def / 252 SpD
Calm Nature
- Scald
- Future Sight
- Slack Off
- Thunder Wave

Espeon @ Choice Specs
Ability: Magic Bounce
Tera Type: Psychic
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Psychic
- Dazzling Gleam
- Shadow Ball
- Trick

Malamar @ Life Orb
Ability: Contrary
Tera Type: Dark
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Superpower
- Knock Off
- Psycho Cut
- Foul Play`,
  },
  {
    name: 'Blaine',
    signatureType: 'Fire',
    isChampion: false,
    // Rapidash isn't legal here - Torkoal stands in.
    export: `Arcanine @ Heavy-Duty Boots
Ability: Intimidate
Tera Type: Fire
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Flare Blitz
- Close Combat
- Extreme Speed
- Morning Sun

Ninetales @ Heavy-Duty Boots
Ability: Drought
Tera Type: Fire
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Fire Blast
- Solar Beam
- Nasty Plot
- Protect

Charizard @ Heavy-Duty Boots
Ability: Solar Power
Tera Type: Fire
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Fire Blast
- Air Slash
- Solar Beam
- Roost

Magmortar @ Choice Specs
Ability: Vital Spirit
Tera Type: Fire
EVs: 4 Def / 252 SpA / 252 Spe
Modest Nature
- Fire Blast
- Thunderbolt
- Focus Blast
- Psychic

Flareon @ Choice Band
Ability: Guts
Tera Type: Fire
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Flare Blitz
- Superpower
- Facade
- Quick Attack

Torkoal @ Heavy-Duty Boots
Ability: Drought
Tera Type: Fire
EVs: 252 HP / 252 SpA / 4 SpD
Quiet Nature
- Lava Plume
- Toxic
- Rapid Spin
- Stealth Rock`,
  },
  {
    name: 'Giovanni',
    signatureType: 'Ground',
    isChampion: false,
    // Marowak/Nidoking/Nidoqueen aren't legal here - filled out with other
    // Ground-types.
    export: `Rhyperior @ Leftovers
Ability: Solid Rock
Tera Type: Rock
EVs: 252 HP / 252 Atk / 4 Def
Adamant Nature
- Earthquake
- Rock Blast
- Megahorn
- Stealth Rock

Golem @ Leftovers
Ability: Sturdy
Tera Type: Rock
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
- Earthquake
- Stone Edge
- Stealth Rock
- Explosion

Sandslash @ Life Orb
Ability: Sand Rush
Tera Type: Ground
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Earthquake
- Rock Slide
- Knock Off
- Rapid Spin

Donphan @ Leftovers
Ability: Sturdy
Tera Type: Ground
EVs: 252 HP / 252 Def / 4 SpD
Impish Nature
- Stealth Rock
- Earthquake
- Knock Off
- Rapid Spin

Whiscash @ Leftovers
Ability: Oblivious
Tera Type: Ground
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
- Earthquake
- Scald
- Toxic
- Stealth Rock

Camerupt @ Life Orb
Ability: Solid Rock
Tera Type: Ground
EVs: 4 Def / 252 SpA / 252 Spe
Modest Nature
- Earth Power
- Fire Blast
- Ancient Power
- Stealth Rock`,
  },
  {
    name: 'Janine',
    signatureType: 'Poison',
    isChampion: false,
    // Crobat isn't legal here - Muk-Alola stands in.
    export: `Venomoth @ Heavy-Duty Boots
Ability: Tinted Lens
Tera Type: Bug
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Bug Buzz
- Sludge Bomb
- Quiver Dance
- Roost

Weezing @ Heavy-Duty Boots
Ability: Levitate
Tera Type: Fire
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
- Sludge Bomb
- Flamethrower
- Pain Split
- Will-O-Wisp

Ariados @ Leftovers
Ability: Sniper
Tera Type: Bug
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Megahorn
- Sucker Punch
- Poison Jab
- Sticky Web

Muk-Alola @ Black Sludge
Ability: Poison Touch
Tera Type: Poison
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
- Poison Jab
- Knock Off
- Drain Punch
- Shadow Sneak

Arbok @ Black Sludge
Ability: Intimidate
Tera Type: Poison
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Gunk Shot
- Earthquake
- Coil
- Glare

Tentacruel @ Black Sludge
Ability: Liquid Ooze
Tera Type: Water
EVs: 252 HP / 4 Def / 252 SpD
Calm Nature
- Scald
- Rapid Spin
- Toxic Spikes
- Sludge Bomb`,
  },
  {
    name: 'Whitney',
    signatureType: 'Normal',
    isChampion: false,
    // Lopunny/Miltank aren't legal here - Cinccino/Dudunsparce stand in.
    export: `Dudunsparce @ Leftovers
Ability: Serene Grace
Tera Type: Normal
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
- Body Slam
- Earthquake
- Roost
- Coil

Blissey @ Leftovers
Ability: Natural Cure
Tera Type: Fairy
EVs: 252 HP / 4 Def / 252 SpD
Calm Nature
- Seismic Toss
- Soft-Boiled
- Toxic
- Heal Bell

Tauros @ Choice Band
Ability: Intimidate
Tera Type: Normal
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Double-Edge
- Earthquake
- Zen Headbutt
- Iron Head

Ambipom @ Life Orb
Ability: Technician
Tera Type: Normal
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Double Hit
- Knock Off
- U-turn
- Low Kick

Ursaring @ Choice Band
Ability: Guts
Tera Type: Normal
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Facade
- Close Combat
- Earthquake
- Crunch

Cinccino @ Life Orb
Ability: Skill Link
Tera Type: Normal
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Bullet Seed
- Rock Blast
- Tail Slap
- Knock Off`,
  },
  {
    name: 'Morty',
    signatureType: 'Ghost',
    isChampion: false,
    export: `Gengar @ Life Orb
Ability: Cursed Body
Tera Type: Ghost
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Shadow Ball
- Sludge Wave
- Focus Blast
- Nasty Plot

Mismagius @ Life Orb
Ability: Levitate
Tera Type: Fairy
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Shadow Ball
- Dazzling Gleam
- Nasty Plot
- Taunt

Banette @ Life Orb
Ability: Frisk
Tera Type: Ghost
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Shadow Claw
- Gunk Shot
- Knock Off
- Destiny Bond

Dusknoir @ Leftovers
Ability: Pressure
Tera Type: Ghost
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
- Shadow Sneak
- Earthquake
- Will-O-Wisp
- Pain Split

Chandelure @ Choice Specs
Ability: Flash Fire
Tera Type: Ghost
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Shadow Ball
- Fire Blast
- Trick
- Psychic

Froslass @ Heavy-Duty Boots
Ability: Cursed Body
Tera Type: Ghost
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Ice Beam
- Shadow Ball
- Spikes
- Destiny Bond`,
  },
  {
    name: 'Falkner',
    signatureType: 'Flying',
    isChampion: false,
    // Crobat/Aerodactyl/Xatu/Swellow/Pidgeot aren't legal here - filled out
    // with other Flying-types.
    export: `Swanna @ Heavy-Duty Boots
Ability: Hydration
Tera Type: Flying
EVs: 4 Def / 252 SpA / 252 Spe
Modest Nature
- Hurricane
- Scald
- Roost
- Defog

Honchkrow @ Life Orb
Ability: Moxie
Tera Type: Dark
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Brave Bird
- Sucker Punch
- Superpower
- Night Slash

Talonflame @ Heavy-Duty Boots
Ability: Gale Wings
Tera Type: Flying
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Brave Bird
- Flare Blitz
- U-turn
- Swords Dance

Skarmory @ Rocky Helmet
Ability: Sturdy
Tera Type: Flying
EVs: 252 HP / 252 Def / 4 SpD
Impish Nature
- Body Press
- Iron Defense
- Roost
- Spikes

Staraptor @ Choice Band
Ability: Reckless
Tera Type: Flying
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Double-Edge
- Brave Bird
- Close Combat
- U-turn

Toucannon @ Choice Band
Ability: Skill Link
Tera Type: Flying
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Beak Blast
- Rock Blast
- Bullet Seed
- U-turn`,
  },
  {
    name: 'Sidney',
    signatureType: 'Dark',
    isChampion: false,
    // Sharpedo/Absol aren't legal here - filled out with other Dark-types.
    export: `Scrafty @ Assault Vest
Ability: Shed Skin
Tera Type: Dark
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
- Drain Punch
- Knock Off
- Ice Punch
- Zen Headbutt

Shiftry @ Life Orb
Ability: Chlorophyll
Tera Type: Dark
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Knock Off
- Leaf Blade
- Sucker Punch
- Low Kick

Zoroark @ Choice Specs
Ability: Illusion
Tera Type: Dark
EVs: 4 Def / 252 SpA / 252 Spe
Naive Nature
- Dark Pulse
- Flamethrower
- Focus Blast
- U-turn

Bisharp @ Life Orb
Ability: Defiant
Tera Type: Dark
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Knock Off
- Iron Head
- Sucker Punch
- Swords Dance

Mandibuzz @ Leftovers
Ability: Overcoat
Tera Type: Dark
EVs: 252 HP / 4 Def / 252 SpD
Careful Nature
- Foul Play
- Toxic
- Roost
- Defog

Houndoom @ Life Orb
Ability: Flash Fire
Tera Type: Dark
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Fire Blast
- Dark Pulse
- Sludge Bomb
- Nasty Plot`,
  },
  {
    name: 'Maylene',
    signatureType: 'Fighting',
    isChampion: false,
    // Machamp isn't legal here - Hariyama stands in.
    export: `Lucario @ Life Orb
Ability: Justified
Tera Type: Fighting
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Close Combat
- Extreme Speed
- Ice Punch
- Swords Dance

Infernape @ Life Orb
Ability: Blaze
Tera Type: Fighting
EVs: 4 HP / 252 Atk / 252 Spe
Naive Nature
- Close Combat
- Flare Blitz
- Grass Knot
- U-turn

Toxicroak @ Life Orb
Ability: Dry Skin
Tera Type: Fighting
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Swords Dance
- Gunk Shot
- Drain Punch
- Sucker Punch

Gallade @ Life Orb
Ability: Sharpness
Tera Type: Fighting
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Close Combat
- Psycho Cut
- Knock Off
- Swords Dance

Medicham @ Life Orb
Ability: Pure Power
Tera Type: Fighting
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- High Jump Kick
- Zen Headbutt
- Ice Punch
- Thunder Punch

Hariyama @ Assault Vest
Ability: Guts
Tera Type: Fighting
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
- Close Combat
- Knock Off
- Bullet Punch
- Fake Out`,
  },
  {
    name: 'Opal',
    signatureType: 'Fairy',
    isChampion: false,
    // Mawile/Togekiss aren't legal here - filled out with other Fairy-types;
    // team is otherwise an extension of Opal's real (smaller) canon roster.
    export: `Weezing @ Heavy-Duty Boots
Ability: Levitate
Tera Type: Fairy
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
- Will-O-Wisp
- Sludge Bomb
- Pain Split
- Toxic Spikes

Granbull @ Leftovers
Ability: Intimidate
Tera Type: Fairy
EVs: 252 HP / 252 Def / 4 SpD
Impish Nature
- Play Rough
- Earthquake
- Heal Bell
- Thunder Wave

Grimmsnarl @ Light Clay
Ability: Prankster
Tera Type: Fairy
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
- Spirit Break
- Sucker Punch
- Light Screen
- Reflect

Alcremie @ Leftovers
Ability: Aroma Veil
Tera Type: Fairy
EVs: 252 HP / 4 Def / 252 SpD
Calm Nature
- Dazzling Gleam
- Calm Mind
- Recover
- Mystical Fire

Sylveon @ Leftovers
Ability: Pixilate
Tera Type: Fairy
EVs: 252 HP / 4 Def / 252 SpD
Calm Nature
- Mystical Fire
- Hyper Voice
- Wish
- Protect

Florges @ Leftovers
Ability: Flower Veil
Tera Type: Fairy
EVs: 252 HP / 4 Def / 252 SpD
Calm Nature
- Moonblast
- Calm Mind
- Wish
- Protect`,
  },
  {
    name: 'Iono',
    signatureType: 'Electric',
    isChampion: false,
    export: `Kilowattrel @ Heavy-Duty Boots
Ability: Volt Absorb
Tera Type: Electric
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Hurricane
- Thunderbolt
- Volt Switch
- Roost

Electrode @ Life Orb
Ability: Aftermath
Tera Type: Electric
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Thunderbolt
- Volt Switch
- Explosion
- Taunt

Bellibolt @ Assault Vest
Ability: Electromorphosis
Tera Type: Electric
EVs: 252 HP / 4 SpA / 252 SpD
Careful Nature
- Discharge
- Muddy Water
- Slack Off
- Toxic

Luxray @ Choice Band
Ability: Intimidate
Tera Type: Electric
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Wild Charge
- Facade
- Crunch
- Superpower

Electivire @ Life Orb
Ability: Motor Drive
Tera Type: Electric
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Wild Charge
- Cross Chop
- Ice Punch
- Earthquake

Mismagius @ Life Orb
Ability: Levitate
Tera Type: Electric
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Shadow Ball
- Dazzling Gleam
- Nasty Plot
- Taunt`,
  },
  {
    name: 'Katy',
    signatureType: 'Bug',
    isChampion: false,
    export: `Spidops @ Leftovers
Ability: Insomnia
Tera Type: Bug
EVs: 252 HP / 252 Def / 4 SpD
Impish Nature
- Sticky Web
- Circle Throw
- Toxic Spikes
- Knock Off

Heracross @ Flame Orb
Ability: Guts
Tera Type: Bug
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Facade
- Close Combat
- Megahorn
- Knock Off

Forretress @ Leftovers
Ability: Sturdy
Tera Type: Steel
EVs: 252 HP / 252 Def / 4 SpD
Relaxed Nature
- Stealth Rock
- Spikes
- Gyro Ball
- Rapid Spin

Lokix @ Life Orb
Ability: Tinted Lens
Tera Type: Bug
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- First Impression
- Sucker Punch
- U-turn
- Knock Off

Araquanid @ Assault Vest
Ability: Water Bubble
Tera Type: Bug
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
- Liquidation
- Leech Life
- Crunch
- Toxic

Ursaring @ Choice Band
Ability: Guts
Tera Type: Normal
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Facade
- Close Combat
- Earthquake
- Crunch`,
  },
  {
    name: 'Poppy',
    signatureType: 'Steel',
    isChampion: false,
    export: `Copperajah @ Life Orb
Ability: Sheer Force
Tera Type: Steel
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Heavy Slam
- High Horsepower
- Play Rough
- Superpower

Bastiodon @ Leftovers
Ability: Sturdy
Tera Type: Steel
EVs: 252 HP / 4 Def / 252 SpD
Careful Nature
- Stealth Rock
- Iron Head
- Toxic
- Roar

Bronzong @ Leftovers
Ability: Levitate
Tera Type: Steel
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
- Stealth Rock
- Gyro Ball
- Body Press
- Iron Defense

Magnezone @ Choice Specs
Ability: Magnet Pull
Tera Type: Steel
EVs: 4 Def / 252 SpA / 252 Spe
Modest Nature
- Thunderbolt
- Flash Cannon
- Volt Switch
- Substitute

Corviknight @ Leftovers
Ability: Pressure
Tera Type: Steel
EVs: 252 HP / 252 Def / 4 SpD
Impish Nature
- Brave Bird
- U-turn
- Roost
- Defog

Tinkaton @ Leftovers
Ability: Mold Breaker
Tera Type: Steel
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Gigaton Hammer
- Play Rough
- Knock Off
- Encore`,
  },
  {
    name: 'Grusha',
    signatureType: 'Ice',
    isChampion: false,
    export: `Ninetales-Alola @ Heavy-Duty Boots
Ability: Snow Warning
Tera Type: Ice
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Blizzard
- Moonblast
- Aurora Veil
- Freeze-Dry

Beartic @ Choice Band
Ability: Slush Rush
Tera Type: Ice
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Icicle Crash
- Superpower
- Aqua Jet
- Liquidation

Frosmoth @ Heavy-Duty Boots
Ability: Ice Scales
Tera Type: Ice
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Quiver Dance
- Bug Buzz
- Ice Beam
- Substitute

Cetitan @ Leftovers
Ability: Slush Rush
Tera Type: Ice
EVs: 252 HP / 252 Atk / 4 Def
Adamant Nature
- Belly Drum
- Ice Shard
- Liquidation
- Earthquake

Weavile @ Life Orb
Ability: Pressure
Tera Type: Ice
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Knock Off
- Ice Shard
- Triple Axel
- Low Kick

Altaria @ Leftovers
Ability: Natural Cure
Tera Type: Ice
EVs: 252 HP / 252 Atk / 4 Spe
Adamant Nature
- Dragon Dance
- Facade
- Earthquake
- Roost`,
  },
  {
    name: 'Hassel',
    signatureType: 'Dragon',
    isChampion: false,
    // Baxcalibur is Ubers-tier - Dragapult stands in.
    export: `Duraludon @ Life Orb
Ability: Light Metal
Tera Type: Dragon
EVs: 4 Def / 252 SpA / 252 Spe
Modest Nature
- Draco Meteor
- Flash Cannon
- Thunderbolt
- Body Press

Noivern @ Choice Specs
Ability: Infiltrator
Tera Type: Dragon
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Draco Meteor
- Hurricane
- Boomburst
- U-turn

Haxorus @ Life Orb
Ability: Mold Breaker
Tera Type: Dragon
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Dragon Dance
- Outrage
- Earthquake
- Poison Jab

Dragalge @ Assault Vest
Ability: Adaptability
Tera Type: Dragon
EVs: 252 HP / 252 SpA / 4 SpD
Modest Nature
- Draco Meteor
- Sludge Wave
- Focus Blast
- Scald

Dragonite @ Heavy-Duty Boots
Ability: Multiscale
Tera Type: Dragon
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Dragon Dance
- Extreme Speed
- Earthquake
- Fire Punch

Dragapult @ Choice Specs
Ability: Infiltrator
Tera Type: Ghost
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Shadow Ball
- Draco Meteor
- Flamethrower
- U-turn`,
  },
];

const CHAMPIONS: GymLeaderEntry[] = [
  {
    name: 'Red',
    signatureType: 'Fire',
    isChampion: true,
    export: `Venusaur @ Leftovers
Ability: Chlorophyll
Tera Type: Water
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
- Giga Drain
- Sludge Bomb
- Leech Seed
- Synthesis

Charizard @ Heavy-Duty Boots
Ability: Solar Power
Tera Type: Fire
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Fire Blast
- Air Slash
- Solar Beam
- Roost

Blastoise @ Leftovers
Ability: Torrent
Tera Type: Water
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
- Scald
- Rapid Spin
- Ice Beam
- Roar

Pikachu @ Light Ball
Ability: Static
Tera Type: Electric
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Thunderbolt
- Volt Switch
- Grass Knot
- Nasty Plot

Snorlax @ Leftovers
Ability: Thick Fat
Tera Type: Normal
EVs: 252 HP / 4 Def / 252 SpD
Careful Nature
- Body Slam
- Earthquake
- Curse
- Rest

Lapras @ Leftovers
Ability: Water Absorb
Tera Type: Ice
EVs: 252 HP / 4 Def / 252 SpD
Calm Nature
- Surf
- Freeze-Dry
- Perish Song
- Protect`,
  },
  {
    name: 'Blue',
    signatureType: 'Normal',
    isChampion: true,
    // Aerodactyl/Alakazam/Machamp aren't legal here - filled out with other
    // real Blue Pokémon. Sleep Powder is banned by this format's clause.
    export: `Talonflame @ Heavy-Duty Boots
Ability: Gale Wings
Tera Type: Flying
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Brave Bird
- Flare Blitz
- U-turn
- Swords Dance

Exeggutor @ Heavy-Duty Boots
Ability: Harvest
Tera Type: Psychic
EVs: 252 HP / 252 SpA / 4 SpD
Modest Nature
- Giga Drain
- Psychic
- Toxic
- Leech Seed

Gyarados @ Leftovers
Ability: Intimidate
Tera Type: Water
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Waterfall
- Earthquake
- Ice Fang
- Dragon Dance

Hatterene @ Leftovers
Ability: Magic Bounce
Tera Type: Fairy
EVs: 252 HP / 252 SpA / 4 SpD
Calm Nature
- Calm Mind
- Draining Kiss
- Psyshock
- Mystical Fire

Arcanine @ Heavy-Duty Boots
Ability: Intimidate
Tera Type: Fire
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Flare Blitz
- Close Combat
- Extreme Speed
- Morning Sun

Hitmonchan @ Assault Vest
Ability: Iron Fist
Tera Type: Fighting
EVs: 252 HP / 252 Atk / 4 SpD
Adamant Nature
- Mach Punch
- Close Combat
- Ice Punch
- Thunder Punch`,
  },
  {
    name: 'Lance',
    signatureType: 'Dragon',
    isChampion: true,
    export: `Dragonite @ Heavy-Duty Boots
Ability: Multiscale
Tera Type: Dragon
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Dragon Dance
- Extreme Speed
- Earthquake
- Fire Punch

Salamence @ Heavy-Duty Boots
Ability: Intimidate
Tera Type: Dragon
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Dragon Dance
- Dual Wingbeat
- Earthquake
- Roost

Kingdra @ Choice Specs
Ability: Swift Swim
Tera Type: Dragon
EVs: 4 Def / 252 SpA / 252 Spe
Modest Nature
- Draco Meteor
- Surf
- Ice Beam
- Dragon Pulse

Hydreigon @ Life Orb
Ability: Levitate
Tera Type: Dragon
EVs: 4 Def / 252 SpA / 252 Spe
Modest Nature
- Draco Meteor
- Dark Pulse
- Flash Cannon
- Flamethrower

Haxorus @ Life Orb
Ability: Mold Breaker
Tera Type: Dragon
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Dragon Dance
- Outrage
- Earthquake
- Poison Jab

Flygon @ Choice Scarf
Ability: Levitate
Tera Type: Dragon
EVs: 252 Atk / 4 Def / 252 Spe
Jolly Nature
- Earthquake
- Outrage
- U-turn
- Stone Edge`,
  },
  {
    name: 'Steven',
    signatureType: 'Steel',
    isChampion: true,
    // Aggron/Archeops/Cradily/Armaldo aren't legal here - filled out with
    // other Steel-types.
    export: `Metagross @ Life Orb
Ability: Clear Body
Tera Type: Steel
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Meteor Mash
- Zen Headbutt
- Earthquake
- Ice Punch

Excadrill @ Choice Scarf
Ability: Sand Rush
Tera Type: Ground
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Earthquake
- Iron Head
- Rock Slide
- Rapid Spin

Klefki @ Leftovers
Ability: Prankster
Tera Type: Steel
EVs: 252 HP / 4 Def / 252 SpD
Careful Nature
- Spikes
- Thunder Wave
- Play Rough
- Foul Play

Scizor @ Choice Band
Ability: Technician
Tera Type: Steel
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Bullet Punch
- U-turn
- Knock Off
- Superpower

Empoleon @ Leftovers
Ability: Competitive
Tera Type: Steel
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
- Scald
- Roar
- Stealth Rock
- Flip Turn

Bronzong @ Leftovers
Ability: Levitate
Tera Type: Steel
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
- Stealth Rock
- Gyro Ball
- Body Press
- Iron Defense`,
  },
  {
    name: 'Wallace',
    signatureType: 'Water',
    isChampion: true,
    // Sharpedo/Walrein/Starmie aren't legal here - filled out with other
    // Water-types.
    export: `Milotic @ Leftovers
Ability: Marvel Scale
Tera Type: Water
EVs: 252 HP / 252 Def / 4 SpD
Bold Nature
- Scald
- Recover
- Toxic
- Ice Beam

Ludicolo @ Life Orb
Ability: Swift Swim
Tera Type: Water
EVs: 4 Def / 252 SpA / 252 Spe
Modest Nature
- Hydro Pump
- Giga Drain
- Ice Beam
- Rain Dance

Swampert @ Leftovers
Ability: Torrent
Tera Type: Water
EVs: 252 HP / 252 Def / 4 SpD
Relaxed Nature
- Scald
- Earthquake
- Stealth Rock
- Roar

Pelipper @ Damp Rock
Ability: Drizzle
Tera Type: Water
EVs: 252 HP / 252 Def / 4 SpA
Bold Nature
- Hurricane
- Scald
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

Basculegion @ Choice Band
Ability: Adaptability
Tera Type: Water
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Wave Crash
- Flip Turn
- Aqua Jet
- Crunch`,
  },
  {
    name: 'Cynthia',
    signatureType: 'Dragon',
    isChampion: true,
    // Togekiss/Roserade aren't legal here - filled out with other real
    // Pokémon of Cynthia's.
    export: `Garchomp @ Rocky Helmet
Ability: Rough Skin
Tera Type: Ground
EVs: 252 HP / 252 Def / 4 Spe
Impish Nature
- Stealth Rock
- Earthquake
- Dragon Tail
- Toxic

Spiritomb @ Leftovers
Ability: Infiltrator
Tera Type: Dark
EVs: 252 HP / 4 Atk / 252 SpD
Careful Nature
- Foul Play
- Sucker Punch
- Pain Split
- Will-O-Wisp

Gardevoir @ Choice Specs
Ability: Trace
Tera Type: Fairy
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Psychic
- Moonblast
- Shadow Ball
- Trick

Lucario @ Life Orb
Ability: Justified
Tera Type: Fighting
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Close Combat
- Extreme Speed
- Ice Punch
- Swords Dance

Indeedee @ Choice Specs
Ability: Psychic Surge
Tera Type: Psychic
EVs: 4 Def / 252 SpA / 252 Spe
Modest Nature
- Psychic
- Expanding Force
- Dazzling Gleam
- Shadow Ball

Glaceon @ Leftovers
Ability: Ice Body
Tera Type: Ice
EVs: 252 HP / 4 Def / 252 SpD
Calm Nature
- Ice Beam
- Shadow Ball
- Wish
- Protect`,
  },
  {
    name: 'Alder',
    signatureType: 'Fire',
    isChampion: true,
    // Volcarona is Ubers-tier - Skeledirge stands in.
    export: `Skeledirge @ Heavy-Duty Boots
Ability: Unaware
Tera Type: Fairy
EVs: 252 HP / 8 SpA / 248 SpD
Calm Nature
- Torch Song
- Slack Off
- Will-O-Wisp
- Hex

Conkeldurr @ Assault Vest
Ability: Guts
Tera Type: Fighting
EVs: 252 HP / 252 Atk / 4 Def
Adamant Nature
- Drain Punch
- Mach Punch
- Knock Off
- Ice Punch

Reuniclus @ Life Orb
Ability: Magic Guard
Tera Type: Psychic
EVs: 252 HP / 252 SpA / 4 SpD
Quiet Nature
- Psyshock
- Focus Blast
- Calm Mind
- Recover

Krookodile @ Life Orb
Ability: Moxie
Tera Type: Dark
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Knock Off
- Earthquake
- Crunch
- Stone Edge

Chandelure @ Choice Specs
Ability: Flash Fire
Tera Type: Ghost
EVs: 4 Def / 252 SpA / 252 Spe
Timid Nature
- Shadow Ball
- Fire Blast
- Trick
- Psychic

Braviary @ Choice Band
Ability: Defiant
Tera Type: Flying
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Brave Bird
- Close Combat
- U-turn
- Superpower`,
  },
];

function main() {
  const validator = new TeamValidator('gen9ou');
  const out: Array<{name: string; signatureType: string; isChampion: boolean; data: unknown[]}> = [];

  for (const entry of [...LEADERS, ...CHAMPIONS]) {
    const sets = Teams.import(entry.export) as unknown as PokemonSet[] | null;
    if (!sets || sets.length !== 6) {
      console.warn(`SKIP "${entry.name}": did not import as 6 mons (got ${sets?.length ?? 0})`);
      continue;
    }
    const problems = validator.validateTeam(sets as never);
    if (problems && problems.length) {
      console.warn(`SKIP "${entry.name}": ${problems.join('; ')}`);
      continue;
    }
    out.push({
      name: entry.name,
      signatureType: entry.signatureType,
      isChampion: entry.isChampion,
      data: sets.map(setToTeamMember),
    });
    console.log(`ok  "${entry.name}" (${entry.signatureType}${entry.isChampion ? ', champion' : ''}): ${sets.map(s => s.species).join(', ')}`);
  }

  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwrote ${OUT} with ${out.length}/${LEADERS.length + CHAMPIONS.length} team(s)`);
}

main();
