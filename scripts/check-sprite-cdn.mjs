/**
 * Does the sprite CDN actually serve what @pkmn/img claims?
 *
 * test/app/sprite-coverage.test.ts gates the app's *resolution* offline: every
 * species lands on a real icon cell and a real gen5 URL. It cannot tell you
 * whether that URL 200s, because @pkmn/img derives URLs from the name and never
 * fetches. This script closes that half by HEAD-ing every tier of every species
 * in every shipped pack against play.pokemonshowdown.com.
 *
 * It is a script, not a test: it needs the network, and upstream inventory is
 * not something a build should fail on. Run it when the packs change, or when a
 * sprite looks wrong in production.
 *
 *   node scripts/check-sprite-cdn.mjs [--json out.json]
 */
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {Icons, Sprites} = require('@pkmn/img');

const packs = {
  'vendored-teams': 'src/data/vendored-teams.gen9ou.json',
  'mined-teams': 'src/data/mined-teams.gen9ou.json',
  'gym-leader-teams': 'src/data/gym-leader-teams.gen9ou.json',
};

const species = new Set();
// Must stay in step with PACKS in test/app/sprite-coverage.test.ts: the whole
// point of this script is to confirm the CDN serves what that gate resolves, so
// sweeping a smaller set would leave the gate's claim partly unchecked.
for (const path of [...Object.values(packs), 'test/fixtures/gen9ou.teams.full.json']) {
  for (const team of JSON.parse(readFileSync(path, 'utf8'))) {
    for (const member of team.data) if (member.species) species.add(member.species);
  }
}
for (const name of Object.keys(JSON.parse(readFileSync('test/fixtures/gen9ou.sets.full.json', 'utf8')))) {
  species.add(name);
}
const ALL = [...species].sort();
console.log(`checking ${ALL.length} species against the sprite CDN\n`);

/** Every URL the app could ask for, per species: the two live tiers, both facings. */
function urlsFor(name) {
  const out = [];
  for (const gen of ['gen5ani', 'gen5']) {
    for (const side of [undefined, 'p1']) {
      const {url} = Sprites.getPokemon(name, side ? {gen, side} : {gen});
      // Asking for gen5ani on a species without one hands back the static png;
      // dedupe so it is not counted as an animated tier that failed.
      out.push({tier: url.includes('/gen5ani/') ? 'gen5ani' : 'gen5', back: side === 'p1', url});
    }
  }
  const icon = /url\((https:[^)]+)\)/.exec(Icons.getPokemon(name).style);
  if (icon) out.push({tier: 'icon-sheet', back: false, url: icon[1]});
  return [...new Map(out.map(u => [u.url + u.back, u])).values()];
}

const jobs = ALL.flatMap(name => urlsFor(name).map(u => ({name, ...u})));
console.log(`${jobs.length} distinct URLs to probe\n`);

const results = [];
const CONCURRENCY = 24;
let cursor = 0;
async function worker() {
  while (cursor < jobs.length) {
    const job = jobs[cursor++];
    try {
      const res = await fetch(job.url, {method: 'HEAD'});
      results.push({...job, status: res.status});
    } catch (e) {
      results.push({...job, status: 0, error: String(e).slice(0, 80)});
    }
  }
}
await Promise.all(Array.from({length: CONCURRENCY}, worker));

const byTier = {};
for (const r of results) {
  byTier[r.tier] ??= {ok: 0, bad: []};
  if (r.status === 200) byTier[r.tier].ok++;
  else byTier[r.tier].bad.push(`${r.name}${r.back ? ' (back)' : ''} -> ${r.status}`);
}

console.log('=== per tier ===');
for (const [tier, {ok, bad}] of Object.entries(byTier)) {
  console.log(`  ${tier.padEnd(11)} ${ok}/${ok + bad.length} served`);
  for (const b of bad.slice(0, 12)) console.log(`      MISSING ${b}`);
  if (bad.length > 12) console.log(`      ... and ${bad.length - 12} more`);
}

const animated = ALL.filter(n => Sprites.getPokemon(n, {gen: 'gen5ani'}).url.endsWith('.gif'));
const servedAnimated = animated.filter(n =>
  results.some(r => r.name === n && r.tier === 'gen5ani' && !r.back && r.status === 200)
);
console.log(
  `\n=== animation reality check ===\n` +
    `  @pkmn/img claims an animated sprite for : ${animated.length}/${ALL.length}\n` +
    `  the CDN actually serves it for          : ${servedAnimated.length}/${ALL.length}\n` +
    `  claimed-but-404 (would fall back static): ${animated.length - servedAnimated.length}\n`
);

const failures = results.filter(r => r.status !== 200);
console.log(`total non-200: ${failures.length}/${results.length}`);

const jsonFlag = process.argv.indexOf('--json');
if (jsonFlag !== -1 && process.argv[jsonFlag + 1]) {
  const {writeFileSync} = await import('node:fs');
  writeFileSync(process.argv[jsonFlag + 1], JSON.stringify({results, byTier}, null, 2));
  console.log(`wrote ${process.argv[jsonFlag + 1]}`);
}
process.exit(failures.length ? 1 : 0);
