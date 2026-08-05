// Pre-deploy checks: every referenced asset exists with exactly matching case
// (GitHub Pages is case-sensitive, Windows is not), and spawning behaves.
import fs from "fs";
import path from "path";
import {
  createState, WARLOCK_TILE, PLAYER_TEAM_CAP, ENEMY_TEAM_CAP,
} from "../js/state.js";
import {
  generateMap, canWalk, computeReachable, SPAWN_ANCHOR, MAP_W, POOL, HOUSE, HOUSE_XS,
  TAVERN, T, tileAt,
} from "../js/map.js";

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
if (sprites.ghost) {
  for (const d of ["up", "down", "left", "right"]) sprites.ghost.walk[d].forEach((p) => refs.add(p));
} else {
  fail("sprites.json has no ghost frames");
}
for (const n of npcs) refs.add(n["npc-portrait-reference"]);
refs.add(warlock["npc-portrait-reference"]);
refs.add("assets/ui/start_screen.jpg");
refs.add("assets/tiles/houses/bagofcoins.png");

const decor = fs.existsSync("assets/decor/decor.json")
  ? JSON.parse(fs.readFileSync("assets/decor/decor.json", "utf8"))
  : null;
if (decor) {
  for (const v of Object.values(decor)) {
    if (Array.isArray(v)) v.forEach((it) => refs.add(it.src));
    else if (v && v.src) refs.add(v.src);
  }
}

const missing = [...refs].filter((r) => !existsExact(r));
if (missing.length) missing.forEach((m) => fail(`missing or wrong case: ${m}`));
else ok(`all ${refs.size} asset references resolve with exact case`);

// --- Data shape ------------------------------------------------------------

const REQUIRED = [
  "npc-label", "npc-nickname", "npc-profession", "npc-portrait-reference",
  "npc-greeting-text", "npc-quest-information", "npc-quest-completion-message",
  "npc-quest-state", "npc-quest-completion-code",
];

// Identity mirrors js/assets.js: derived from the portrait filename, never
// from npc-label, which holds real names that may repeat.
const idOf = (n) => n["npc-portrait-reference"].split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
for (const n of npcs) n.id = idOf(n);
warlock.id = "warlock";

if (npcs.length !== 15) fail(`expected 15 NPCs, found ${npcs.length}`);
else ok("15 assignable NPCs");

for (const n of npcs) {
  for (const k of REQUIRED) if (!(k in n)) fail(`${n["npc-label"]} missing ${k}`);
  if (!/^\d{6}$/.test(n["npc-quest-completion-code"])) fail(`${n["npc-label"]} code is not 6 digits`);
  if (n["npc-quest-state"] !== "not-accepted") fail(`${n["npc-label"]} npc-quest-state must start as not-accepted`);
}

const ids = npcs.map((n) => n.id);
if (new Set(ids).size !== ids.length) fail(`duplicate portrait identities: ${ids.join(", ")}`);
else ok(`15 distinct identities, one per portrait`);
if (ids.includes("warlock")) fail("warlock must not be in npcs.json");
else ok("warlock excluded from the assignable roster");

// Real names may legitimately repeat; surface it so it is a choice, not a slip.
const names = npcs.map((n) => n["npc-label"]).concat(warlock["npc-label"]);
const dupNames = names.filter((v, i) => names.indexOf(v) !== i);
if (dupNames.length) {
  console.log(`NOTE  name shown on more than one character: ${[...new Set(dupNames)].join(", ")}`);
}

const codes = npcs.map((n) => n["npc-quest-completion-code"])
  .concat(warlock.trials.map((t) => t["trial-completion-code"]));
if (new Set(codes).size !== codes.length) {
  const dup = codes.filter((v, i) => codes.indexOf(v) !== i);
  fail(`duplicate completion codes: ${[...new Set(dup)].join(", ")}`);
} else ok(`all ${codes.length} completion codes are 6-digit and unique`);

if (warlock.trials.length !== 7) fail(`expected 7 trials, found ${warlock.trials.length}`);
else ok("7 warlock trials");
warlock.trials.forEach((t, i) => {
  if (!/^\d{6}$/.test(t["trial-completion-code"])) fail(`trial ${t.index} code is not 6 digits`);
  const expected = i === 0 ? "available" : "locked";
  if (t["trial-state"] !== expected) fail(`trial ${t.index} state must be "${expected}"`);
});

// Unwritten content: catches template text left in by accident.
const PLACEHOLDER = /YOUR TEXT|PLACEHOLDER/i;
const unwritten = [];
for (const n of npcs) {
  for (const k of REQUIRED) if (PLACEHOLDER.test(String(n[k]))) unwritten.push(`${n["npc-label"]} · ${k}`);
}
for (const [k, v] of Object.entries(warlock)) {
  if (typeof v === "string" && PLACEHOLDER.test(v)) unwritten.push(`Warlock · ${k}`);
}
warlock.trials.forEach((t) => {
  for (const [k, v] of Object.entries(t)) {
    if (typeof v === "string" && PLACEHOLDER.test(v)) unwritten.push(`trial ${t.index} · ${k}`);
  }
});
for (const b of JSON.parse(fs.readFileSync("data/info.json", "utf8")).blocks) {
  if (PLACEHOLDER.test(b.heading) || PLACEHOLDER.test(b.text)) unwritten.push(`info · ${b.heading}`);
}
if (unwritten.length) {
  console.log(`NOTE  ${unwritten.length} field(s) still hold template text:`);
  unwritten.forEach((u) => console.log(`        ${u}`));
} else ok("no placeholder text left anywhere");

// --- Spawning --------------------------------------------------------------

const map = generateMap(undefined, decor);
const reach = computeReachable(map, SPAWN_ANCHOR.x, SPAWN_ANCHOR.y);
if (decor) ok(`world furnished with ${map.props.length} props, ${map.blocked.size} tiles reserved`);

if (!canWalk(map, WARLOCK_TILE.x, WARLOCK_TILE.y)) fail("warlock tile is impassable");
else if (!reach[WARLOCK_TILE.y * MAP_W + WARLOCK_TILE.x]) fail("warlock tile is unreachable");
else ok("warlock stands on a reachable tile inside the villa");

if (!canWalk(map, SPAWN_ANCHOR.x, SPAWN_ANCHOR.y)) fail("player spawn is impassable");
else ok("player spawns on a walkable tile at the gate");

let bad = 0, collisions = 0;
for (let run = 0; run < 40; run++) {
  const s = createState("pirate", npcs, map);
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

// --- Team caps must still allow every NPC to be assigned -------------------

const assignable = (PLAYER_TEAM_CAP - 1) + ENEMY_TEAM_CAP;
if (assignable < npcs.length) {
  fail(`caps allow only ${assignable} placements for ${npcs.length} NPCs — the teams menu could never be closed`);
} else {
  ok(`team caps admit all ${npcs.length} NPCs (player ${PLAYER_TEAM_CAP - 1} + enemy ${ENEMY_TEAM_CAP})`);
  if (assignable === npcs.length) {
    console.log(`NOTE  the split is forced: exactly ${PLAYER_TEAM_CAP - 1} with you and ${ENEMY_TEAM_CAP} against you`);
  }
}

// --- Houses must be enterable ---------------------------------------------

let doorless = 0, sealed = 0;
for (const hx of HOUSE_XS) {
  let doors = 0;
  for (let x = hx; x <= hx + HOUSE.w; x++) {
    if (tileAt(map, x, HOUSE.y1) === T.DOOR) doors++;
  }
  if (!doors) doorless++;

  // Reachable means "you can get inside", not "one particular tile is free" —
  // furniture legitimately stands on individual tiles, including the centre.
  let anyInside = false;
  for (let y = HOUSE.y0 + 1; y < HOUSE.y1 && !anyInside; y++) {
    for (let x = hx + 1; x < hx + HOUSE.w; x++) {
      if (tileAt(map, x, y) === T.FLOOR && reach[y * MAP_W + x]) { anyInside = true; break; }
    }
  }
  if (!anyInside) sealed++;
}
if (doorless) fail(`${doorless} house(s) have no doorway`);
else ok(`all ${HOUSE_XS.length} houses have a doorway on the south wall`);
if (sealed) fail(`${sealed} house interior(s) are not reachable through the door`);
else ok("every house interior is reachable from outside");

// Tavern must be enterable too, and furniture must not seal any interior.
let tavernDoors = 0;
for (let x = TAVERN.x0; x <= TAVERN.x1; x++) {
  if (tileAt(map, x, TAVERN.y1) === T.DOOR) tavernDoors++;
}
if (!tavernDoors) fail("tavern has no doorway");
else ok(`tavern has a ${tavernDoors}-tile doorway`);

const countReachableFloor = (b) => {
  let total = 0, got = 0;
  for (let y = b.y0 + 1; y < b.y1; y++) {
    for (let x = b.x0 + 1; x < b.x1; x++) {
      if (tileAt(map, x, y) !== T.FLOOR) continue;
      total++;
      if (reach[y * MAP_W + x]) got++;
    }
  }
  return { total, got };
};

const tv = countReachableFloor(TAVERN);
if (tv.got === 0) fail("tavern interior is completely sealed off");
else if (tv.got < tv.total * 0.6) fail(`only ${tv.got}/${tv.total} tavern floor tiles reachable — furniture is blocking it`);
else ok(`tavern interior ${tv.got}/${tv.total} floor tiles reachable`);

let tightHouse = 0;
for (const hx of HOUSE_XS) {
  const r = countReachableFloor({ x0: hx, y0: HOUSE.y0, x1: hx + HOUSE.w, y1: HOUSE.y1 });
  if (r.got < r.total * 0.6) tightHouse++;
}
if (tightHouse) fail(`${tightHouse} house(s) too cluttered to walk around in`);
else ok("all house interiors remain walkable after furnishing");

// --- Pool geometry ---------------------------------------------------------

const pw = POOL.x1 - POOL.x0 + 1, ph = POOL.y1 - POOL.y0 + 1;
let deckRing = true;
for (let x = POOL.x0 - 1; x <= POOL.x1 + 1; x++) {
  if (tileAt(map, x, POOL.y0 - 1) !== T.DECK || tileAt(map, x, POOL.y1 + 1) !== T.DECK) deckRing = false;
}
for (let y = POOL.y0 - 1; y <= POOL.y1 + 1; y++) {
  if (tileAt(map, POOL.x0 - 1, y) !== T.DECK || tileAt(map, POOL.x1 + 1, y) !== T.DECK) deckRing = false;
}
if (!deckRing) fail("pool is not fully ringed by deck tiles");
else ok(`pool is ${pw}x${ph} tiles, fully ringed by deck`);

console.log(fails ? `\n${fails} check(s) failed` : "\nall checks passed");
process.exit(fails ? 1 : 0);
