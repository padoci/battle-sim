/**
 * Which moves get a bespoke animation, and the slug that joins them to CSS.
 *
 * Extracted from SixOhGauntlet so tests can assert the TS list and the
 * app.css rules stay in sync — the join between them is a string convention
 * with nothing enforcing it.
 */

/**
 * How long after a beat starts the hit actually lands, by move category.
 *
 * Mirrors the `--fx-hit-delay` values in app.css ("When the hit lands"). CSS
 * owns the sprite-holder side; this copy exists because the HP block is a
 * sibling of the holder and so has to be told inline. test/visual/fx.spec.ts
 * asserts the two agree.
 */
export const HIT_DELAY = {
  physical: '0.14s',
  special: '0.28s',
} as const;

/** The highest-frequency/most iconic moves (by real usage across the app's
 * own team data — see app.css's "Signature moves" section) get a fully
 * bespoke fx-signature-<slug> override instead of the generic type/category
 * treatment. Deliberately small and curated, not exhaustive — every other
 * move still reads fine via the type/category layers alone. */
export const SIGNATURE_MOVES = new Set([
  'Knock Off',
  'Earthquake',
  'Stealth Rock',
  'Sucker Punch',
  'Close Combat',
  'Shadow Ball',
  'Draco Meteor',
  // Impact-hooked physical moves.
  'U-turn',
  'Rapid Spin',
  'Ice Spinner',
  'Body Press',
  'Iron Head',
  'Headlong Rush',
  'Extreme Speed',
  'Crunch',
  'Kowtow Cleave',
  'Low Kick',
  // Special beam-hooked moves.
  'Ice Beam',
  'Earth Power',
  'Sludge Bomb',
  'Moonblast',
  'Thunderbolt',
  'Make It Rain',
  'Flamethrower',
  'Freeze-Dry',
  // Self lunge-hooked moves (setup/heal/protect — no defender impact).
  'Swords Dance',
  'Calm Mind',
  'Dragon Dance',
  'Protect',
  'Roost',
  'Recover',
  // Target-status moves (see STATUS_SIGNATURE_TARGETS in replay/view.ts).
  'Toxic',
  'Will-O-Wisp',
  'Thunder Wave',
  'Taunt',
  // Field-hooked moves.
  'Spikes',
  'Defog',
  // -- Batch 3 --
  // Impact-hooked physical moves.
  'Flip Turn',
  'Ice Punch',
  'Brave Bird',
  'Ivy Cudgel',
  'Stone Edge',
  'Poison Jab',
  'Superpower',
  'Heavy Slam',
  'Dragon Tail',
  'Facade',
  'Nuzzle',
  'Thunderclap',
  // Special beam-hooked moves.
  'Psychic',
  'Focus Blast',
  'Hurricane',
  'Dragon Pulse',
  'Dark Pulse',
  'Fire Blast',
  'Dazzling Gleam',
  'Surf',
  // Special drain moves (beam-hooked, plus a heal-tinted arrival).
  'Giga Drain',
  'Draining Kiss',
  // Self lunge-hooked moves.
  'Iron Defense',
  'Nasty Plot',
  'Bulk Up',
  'Substitute',
  'Rest',
  // Target-status moves (see STATUS_SIGNATURE_TARGETS in replay/view.ts).
  'Trick',
  'Roar',
  'Encore',
  // -- Batch 4 --
  // Impact-hooked physical moves.
  'Fire Punch',
  'Zen Headbutt',
  'Wood Hammer',
  'Shadow Sneak',
  'Liquidation',
  'Ice Shard',
  'Triple Axel',
  'Waterfall',
  'Ice Fang',
  'Aqua Jet',
  'Rock Slide',
  'Drain Punch',
  'Gyro Ball',
  'Bullet Punch',
  // Special beam-hooked moves.
  'Scald',
  'Flash Cannon',
  'Hydro Pump',
  'Solar Beam',
  'Heat Wave',
  'Mystical Fire',
  'Lava Plume',
  'Hex',
  // Target-status moves (see STATUS_SIGNATURE_TARGETS in replay/view.ts).
  'Stun Spore',
  'Leech Seed',
  'Whirlwind',
  // Self lunge-hooked moves.
  'Quiver Dance',
  'Moonlight',
  'Wish',
  'Light Screen',
  'Reflect',
  // -- Batch 5 --
  // Impact-hooked physical moves.
  'Flare Blitz',
  'Foul Play',
  'Razor Shell',
  'Body Slam',
  'Seismic Toss',
  'Play Rough',
  'Outrage',
  'Bitter Blade',
  'Mortal Spin',
  'Grassy Glide',
  'Thunder Punch',
  'Rock Blast',
  'Megahorn',
  'Gunk Shot',
  'Explosion',
  'First Impression',
  // Special beam-hooked moves.
  'Sludge Wave',
  'Ruination',
  'Weather Ball',
  'Hydro Steam',
  'Fiery Dance',
  'Psyshock',
  // Field-hooked moves.
  'Toxic Spikes',
  'Sticky Web',
  // Self lunge-hooked moves.
  'Sleep Talk',
  'Slack Off',
  'Synthesis',
  'Destiny Bond',
  'Soft-Boiled',
  // Target-status moves (see STATUS_SIGNATURE_TARGETS in replay/view.ts).
  'Skill Swap',
  // -- Batch 6 (covers everything with usage >= 2 in the app's team data) --
  // Impact-hooked physical moves.
  'Head Smash',
  'Double-Edge',
  'Bullet Seed',
  'Shadow Claw',
  'Wild Charge',
  'Leech Life',
  'Gigaton Hammer',
  'Icicle Crash',
  'Mach Punch',
  'Wave Crash',
  'Salt Cure',
  // Special beam-hooked moves.
  'Blizzard',
  'Thunder',
  'Bleakwind Storm',
  'Hyper Voice',
  'Air Slash',
  'Bug Buzz',
  'Grass Knot',
  'Torch Song',
  'Power Gem',
  'Magma Storm',
  'Tachyon Cutter',
  // Self lunge-hooked moves.
  'Coil',
  'Growth',
  'Morning Sun',
  'Heal Bell',
  'Perish Song',
  'Teleport',
  // Target-status moves (see STATUS_SIGNATURE_TARGETS in replay/view.ts).
  'Parting Shot',
  'Strength Sap',
  // -- Batch 7: the most recognizable moves left in the tail (usage == 1 in
  // this dataset, but iconic competitive staples that just happen to fit
  // only one curated team here) --
  // Impact-hooked physical moves.
  'Quick Attack',
  'Night Slash',
  'Leaf Blade',
  'High Jump Kick',
  'Fake Out',
  'Cross Chop',
  'High Horsepower',
  'Meteor Mash',
  'Icicle Spear',
  'Payback',
  'Horn Leech',
  'Solar Blade',
  // Special beam-hooked moves.
  'Ancient Power',
  'Discharge',
  'Muddy Water',
  'Boomburst',
  'Expanding Force',
  'Energy Ball',
  'Stored Power',
  // Self lunge-hooked moves.
  'Trick Room',
  'Rain Dance',
  'Belly Drum',
  'Amnesia',
  'Endure',
  'Aurora Veil',
  'Clangorous Soul',
  'Lunar Dance',
  'Lunar Blessing',
  // Target-status moves (see STATUS_SIGNATURE_TARGETS in replay/view.ts).
  'Glare',
  'Circle Throw',
  // -- Batch 8: the highest base-power tier from the full Gen 9 movepool
  // (beyond this app's own team-data sample — see the batch-7 commit note).
  // Impact-hooked physical moves.
  'Self-Destruct',
  'Focus Punch',
  'Giga Impact',
  'Rock Wrecker',
  'Last Resort',
  'Sky Attack',
  'Bolt Strike',
  'Steel Roller',
  'Axe Kick',
  'Double Shock',
  'Dragon Ascent',
  'Glacial Lance',
  'Glaive Rush',
  'Mega Kick',
  'Power Whip',
  // Special beam-hooked moves.
  'Prismatic Laser',
  'Blast Burn',
  'Chloroblast',
  'Dragon Energy',
  'Eruption',
  'Frenzy Plant',
  'Hydro Cannon',
  'Hyper Beam',
  'Roar of Time',
  'Water Spout',
  'Blood Moon',
  'Doom Desire',
  'Ice Burn',
  'Psycho Boost',
  'Steel Beam',
  // -- Batch 9: more legendary/signature moves from the full movepool --
  // Impact-hooked physical moves.
  'Freeze Shock',
  'Precipice Blades',
  'Pyro Ball',
  'Raging Fury',
  'Shadow Force',
  'Thrash',
  'Volt Tackle',
  'Aura Wheel',
  'Poltergeist',
  'Beak Blast',
  'Behemoth Bash',
  'Behemoth Blade',
  'Collision Course',
  'Crabhammer',
  'Diamond Storm',
  // Special beam-hooked moves.
  'Blue Flare',
  'Electro Shot',
  'Fleur Cannon',
  'Leaf Storm',
  'Overheat',
  'Armor Cannon',
  'Astral Barrage',
  'Belch',
  'Future Sight',
  'Meteor Beam',
  'Petal Dance',
  'Seed Flare',
  'Zap Cannon',
  'Origin Pulse',
  'Aeroblast',
  // -- Batch 10: more from the full movepool's mid-power tier --
  // Impact-hooked physical moves.
  'Dragon Rush',
  'Dynamic Punch',
  'Flying Press',
  'Fusion Bolt',
  'Hammer Arm',
  'Hyper Drill',
  'Hyperspace Fury',
  'Ice Hammer',
  'Iron Tail',
  'Mountain Gale',
  'Sacred Fire',
  'Spin Out',
  'Sunsteel Strike',
  'Supercell Slam',
  'Mighty Cleave',
  // Special beam-hooked moves.
  'Tera Starstorm',
  'Clanging Scales',
  'Steam Eruption',
  'Dream Eater',
  'Dynamax Cannon',
  'Electro Drift',
  'Fusion Flare',
  'Inferno',
  'Judgment',
  'Malignant Chain',
  'Misty Explosion',
  'Moongeist Beam',
  'Photon Geyser',
  'Psystrike',
  'Sandsear Storm',
  // -- Batch 11 --
  // Impact-hooked physical moves.
  'Aqua Tail',
  'Attack Order',
  'Dragon Hammer',
  'Fly',
  'Petal Blizzard',
  'Phantom Force',
  'Raging Bull',
  'Sacred Sword',
  'Take Down',
  'Thunderous Kick',
  'Triple Arrows',
  'Blaze Kick',
  'Bounce',
  'Darkest Lariat',
  'Psychic Fangs',
  // Special beam-hooked moves.
  'Spacial Rend',
  'Springtide Storm',
  'Wildbolt Storm',
  'Luster Purge',
  'Mist Ball',
  'Fiery Wrath',
  'Freezing Glare',
  'Pollen Puff',
  'Revelation Dance',
  'Shell Side Arm',
  'Sparkling Aria',
  'Strange Steam',
  'Uproar',
  'Night Daze',
  'Secret Sword',
  // Batch 12 closes the gap rather than extending the popularity list: these
  // are the last moves in vendored-teams.gen9ou.json without a signature, so
  // every move that can actually turn up in a gauntlet now has one.
  'Ceaseless Edge',
  'Psychic Noise',
  'Flower Trick',
  'Endeavor',
  'Scale Shot',
  'Dragon Darts',
  'Acrobatics',
  'Mirror Coat',
  'Avalanche',
  'Infestation',
  'Aqua Cutter',
  'Volt Switch',
  'Healing Wish',
  'Baneful Bunker',
  // Curse is dual-behaviour — a Ghost user curses the foe, everyone else
  // boosts itself. Only Clodsire, Dondozo and Garganacl run it here, so it is
  // always the self-boost; animated on the caster and deliberately absent
  // from STATUS_SIGNATURE_TARGETS (src/replay/view.ts).
  'Curse',
  'Pain Split',
  'Tickle',
  // Field-level: no fx-signature rule, a token on .stage-field instead.
  'Chilly Reception',
  'Court Change',
  'Haze',
  // Batch 13 widens the target from "moves in this app's team data" to "moves
  // that are semi-viable in OU": everything in a Smogon gen9ou analysis set
  // (data.pkmn.cc/sets/gen9ou.json), plus anything else holding >=0.15% of
  // real OU move slots by weighted usage (data.pkmn.cc/stats/gen9ou.json).
  // Takes the registry from ~97.3% to 99.5% of OU move slots by weighted
  // usage, and to 100% of the moves Smogon writes up for an OU species.
  'Vacuum Wave',
  'Trailblaze',
  'Aura Sphere',
  'Matcha Gotcha',
  'Fickle Beam',
  'Rock Tomb',
  'Alluring Voice',
  'Scorching Sands',
  'Temper Flare',
  'Lunge',
  'Spirit Break',
  'Population Bomb',
  'Fire Fang',
  'Beat Up',
  'Icy Wind',
  'Whirlpool',
  'Brick Break',
  'Smack Down',
  'Dual Wingbeat',
  'Water Shuriken',
  'Bite',
  'Dragon Claw',
  'Counter',
  'Aqua Step',
  'Throat Chop',
  'Clear Smog',
  // Self-hooked (target=self).
  'Agility',
  'Tail Glow',
  'Take Heart',
  'Acid Armor',
  'Tidy Up',
  'Shell Smash',
  'Revival Blessing',
  'Cosmic Power',
  'Victory Dance',
  // Status moves that land on the foe (also in STATUS_SIGNATURE_TARGETS).
  'Memento',
  'Transform',
  // Field-level.
  'Snowscape',
]);

export function signatureSlug(move: string | undefined): string | undefined {
  if (!move || !SIGNATURE_MOVES.has(move)) return undefined;
  return move.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
