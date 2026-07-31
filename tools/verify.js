// Pre-deploy checks: every referenced asset exists with exactly matching case
// (GitHub Pages is case-sensitive, Windows is not), and spawning behaves.
import fs from "fs";
import path from "path";
import { createState, WARLOCK_TILE } from "../js/state.js";
import { generateMap, canWalk, computeReachable, SPAWN_ANCHOR, MAP_W } from "../js/map.js";

let fails = 0;
const fail = (m) => { console.log(`FAIL  ${m}`); fails++; };
const ok = (m) => console.log(`OK    ${m}`);

// --- Case-exact asset existence -------------------------------------------

const dirCache = new Map();
function existsExact(rel) {
  const parts = rel.split("/");
  let cur = ".";
  for (const part of parts) {
    if (!dirCache.has(cur)) {
      try { dirCache.set(cur, fs.readdirSync(cur)); } catch { return false; }
    }
    if (!dirCache.get(cur).includes(part)) return false;
    cur = path.posix.join(cur, part);
  }
  return true;
}

const sprites = JSON.parse(fs.readFileSync("assets/sprites/sprites.json", "utf8"));
const npcs = JSON.parse(fs.readFileSync("data/npcs.json", "utf8"));
const warlock = JSON.parse(fs.readFileSync("data/warlock.json", "utf8"));

const refs = new Set([sprites.player.idle]);
for (const d of ["up", "down", "left", "right"]) {
  sprites.player.walk[d].forEach((p) => refs.add(p));
  sprites.player.attack[d].forEach((p) => refs.add(p));
}
for (const n of Object.values(sprites.npcs)) refs.add(n.idle);
for (const n of npcs) refs.add(n["npc-portrait-reference"]);
refs.add(warlock["npc-portrait-reference"]);
refs.add("assets/ui/start_screen.jpg");

const missing = [...refs].filter((r) => !existsExact(r));
if (missing.length) missing.forEach((m) => fail(`missing or wrong case: ${m}`));
else ok(`all ${refs.size} asset references resolve with exact case`);

// --- Data shape ------------------------------------------------------------

const REQUIRED = [
  "npc-label", "npc-nickname", "npc-profession", "npc-portrait-reference",
  "npc-greeting-text", "npc-quest-information", "npc-quest-completion-message",
  "npc-quest-state", "npc-quest-completion-code",
];
if (npcs.length !== 15) fail(`expected 15 NPCs, found ${npcs.length}`);
else ok("15 assignable NPCs");

for (const n of npcs) {
  for (const k of REQUIRED) if (!(k in n)) fail(`${n["npc-label"]} missing ${k}`);
  if (!/^\d{6}$/.test(n["npc-quest-completion-code"])) fail(`${n["npc-label"]} code is not 6 digits`);
}
const codes = npcs.map((n) => n["npc-quest-completion-code"]);
if (new Set(codes).size !== codes.length) fail("duplicate NPC completion codes");
else ok("NPC codes are 6-digit and unique");

if (warlock.trials.length !== 7) fail(`expected 7 trials, found ${warlock.trials.length}`);
else ok("7 warlock trials");
for (const t of warlock.trials) {
  if (!/^\d{6}$/.test(t["trial-completion-code"])) fail(`trial ${t.index} code is not 6 digits`);
}
if (npcs.some((n) => n["npc-label"] === "warlock")) fail("warlock must not be in npcs.json");
else ok("warlock excluded from the assignable roster");

// --- Spawning --------------------------------------------------------------

const map = generateMap();
const reach = computeReachable(map, SPAWN_ANCHOR.x, SPAWN_ANCHOR.y);

if (!canWalk(map, WARLOCK_TILE.x, WARLOCK_TILE.y)) fail("warlock tile is impassable");
else if (!reach[WARLOCK_TILE.y * MAP_W + WARLOCK_TILE.x]) fail("warlock tile is unreachable");
else ok("warlock stands on a reachable tile inside the villa");

if (!canWalk(map, SPAWN_ANCHOR.x, SPAWN_ANCHOR.y)) fail("player spawn is impassable");
else ok("player spawns on a walkable tile at the gate");

let bad = 0, collisions = 0;
for (let run = 0; run < 40; run++) {
  const s = createState("pirate", npcs);
  const seen = new Set();
  for (const [label, pos] of Object.entries(s.npcs)) {
    if (!canWalk(map, pos.x, pos.y) || !reach[pos.y * MAP_W + pos.x]) bad++;
    const key = `${pos.x},${pos.y}`;
    if (seen.has(key)) collisions++;
    seen.add(key);
  }
  if (Object.keys(s.npcs).length !== 15) fail("createState did not place 15 NPCs");
}
if (bad) fail(`${bad} NPC spawns landed on unreachable or blocked tiles across 40 runs`);
else ok("600 NPC spawns across 40 runs all reachable");
if (collisions) fail(`${collisions} overlapping NPC spawns`);
else ok("no overlapping spawns");

console.log(fails ? `\n${fails} check(s) failed` : "\nall checks passed");
process.exit(fails ? 1 : 0);
