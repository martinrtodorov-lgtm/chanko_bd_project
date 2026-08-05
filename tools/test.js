// Logic tests for the parts that do not need a browser: identity, teams,
// quest and trial progression, and save round-tripping.
//   node tools/test.js
import fs from "fs";

// Minimal localStorage so state.js can be exercised outside a browser.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const S = await import("../js/state.js");
const { generateMap, canWalk, computeReachable, SPAWN_ANCHOR, MAP_W } = await import("../js/map.js");

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ok    ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const eq = (a, b, m = "") => {
  if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const truthy = (v, m) => { if (!v) throw new Error(m || "expected truthy"); };

const npcs = JSON.parse(fs.readFileSync("data/npcs.json", "utf8"));
const warlock = JSON.parse(fs.readFileSync("data/warlock.json", "utf8"));
const idOf = (n) => n["npc-portrait-reference"].split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
for (const n of npcs) n.id = idOf(n);

const decor = JSON.parse(fs.readFileSync("assets/decor/decor.json", "utf8"));
const map = generateMap(undefined, decor);
const fresh = () => S.createState("pirate", npcs, map);

console.log("\nidentity");
t("every NPC gets a distinct id", () => {
  const ids = npcs.map((n) => n.id);
  eq(new Set(ids).size, 15);
});
t("duplicate real names do not collide in state", () => {
  const s = fresh();
  eq(Object.keys(s.teams).length, 15, "team slots");
  eq(Object.keys(s.quests).length, 15, "quest slots");
  truthy(!("Martin Todorov" in s.teams), "labels must not be used as keys");
  truthy("rogue" in s.teams, "rogue id present");
});
t("warlock is not an assignable NPC", () => {
  const s = fresh();
  truthy(!("warlock" in s.teams), "warlock must stay off the roster");
});

console.log("\nteams");
t("player team caps at 8 including Chanko", () => {
  const s = fresh();
  const ids = Object.keys(s.teams);
  for (let i = 0; i < 7; i++) eq(S.assignTeam(s, ids[i], S.TEAM.PLAYER), true, `slot ${i}`);
  eq(S.playerTeamCount(s), 8);
  eq(S.assignTeam(s, ids[7], S.TEAM.PLAYER), "player-full");
});
t("opposing team caps at 8", () => {
  const s = fresh();
  const ids = Object.keys(s.teams);
  for (let i = 0; i < 8; i++) eq(S.assignTeam(s, ids[i], S.TEAM.ENEMY), true, `slot ${i}`);
  eq(S.assignTeam(s, ids[8], S.TEAM.ENEMY), "enemy-full");
});
t("menu cannot close while anyone is neutral", () => {
  const s = fresh();
  eq(S.canCloseTeams(s), false);
  const ids = Object.keys(s.teams);
  ids.slice(0, 7).forEach((id) => S.assignTeam(s, id, S.TEAM.PLAYER));
  ids.slice(7).forEach((id) => S.assignTeam(s, id, S.TEAM.ENEMY));
  eq(S.neutralCount(s), 0);
  eq(S.canCloseTeams(s), true);
});
t("the only closable split is 7 and 8", () => {
  const s = fresh();
  const ids = Object.keys(s.teams);
  ids.slice(0, 5).forEach((id) => S.assignTeam(s, id, S.TEAM.PLAYER));
  const rest = ids.slice(5);
  let placed = 0;
  for (const id of rest) if (S.assignTeam(s, id, S.TEAM.ENEMY) === true) placed++;
  eq(placed, 8, "enemy accepts only 8");
  truthy(S.neutralCount(s) > 0, "two stay neutral, so the menu stays open");
  eq(S.canCloseTeams(s), false);
});
t("sprite follows team, warlock is always the warlock", () => {
  const s = fresh();
  S.assignTeam(s, "cook", S.TEAM.PLAYER);
  S.assignTeam(s, "jester", S.TEAM.ENEMY);
  eq(S.npcSpriteKey(s, "cook"), "pirate");
  eq(S.npcSpriteKey(s, "jester"), "viking");
  eq(S.npcSpriteKey(s, "warlock"), "warlock");
});
t("difficulty depends on allegiance", () => {
  const s = fresh();
  S.assignTeam(s, "cook", S.TEAM.PLAYER);
  S.assignTeam(s, "jester", S.TEAM.ENEMY);
  eq(S.dcFor(s, "cook"), 13);
  eq(S.dcFor(s, "jester"), 18);
});

console.log("\nquests");
t("codes match the data file", () => {
  const s = fresh();
  for (const n of npcs) {
    truthy(/^\d{6}$/.test(n["npc-quest-completion-code"]), `${n["npc-label"]} code`);
    eq(s.quests[n.id].state, S.QUEST.NONE);
  }
});
t("quest progresses not-accepted to accepted to completed", () => {
  const s = fresh();
  const q = s.quests.cook;
  q.state = S.QUEST.ACCEPTED;
  eq(q.state, "accepted");
  q.state = S.QUEST.DONE;
  eq(q.state, "completed");
});
t("changing team keeps quest progress", () => {
  const s = fresh();
  S.assignTeam(s, "cook", S.TEAM.PLAYER);
  s.quests.cook.state = S.QUEST.ACCEPTED;
  S.assignTeam(s, "cook", S.TEAM.ENEMY);
  eq(s.quests.cook.state, "accepted", "progress must survive a swap");
  eq(S.dcFor(s, "cook"), 18, "but the DC follows the new side");
});

console.log("\nwarlock trials");
t("only the first trial starts available", () => {
  const s = fresh();
  eq(s.warlock.trials[0].state, S.TRIAL.AVAILABLE);
  for (let i = 1; i < 7; i++) eq(s.warlock.trials[i].state, S.TRIAL.LOCKED, `trial ${i + 1}`);
  eq(S.currentTrialIndex(s), 0);
});
t("completing a trial unlocks exactly the next one", () => {
  const s = fresh();
  S.completeTrial(s, 0);
  eq(s.warlock.trials[0].state, S.TRIAL.DONE);
  eq(s.warlock.trials[1].state, S.TRIAL.AVAILABLE);
  eq(s.warlock.trials[2].state, S.TRIAL.LOCKED);
  eq(S.currentTrialIndex(s), 1);
  eq(s.won, false);
});
t("the seventh trial wins the game", () => {
  const s = fresh();
  for (let i = 0; i < 7; i++) {
    eq(s.won, false, `not won before trial ${i + 1}`);
    S.completeTrial(s, i);
  }
  eq(s.won, true);
  eq(S.currentTrialIndex(s), -1);
});
t("all seven trial codes are usable and distinct", () => {
  const codes = warlock.trials.map((x) => x["trial-completion-code"]);
  eq(codes.length, 7);
  eq(new Set(codes).size, 7);
  codes.forEach((c, i) => truthy(/^\d{6}$/.test(c), `trial ${i + 1} code ${c}`));
});

console.log("\ncoin bag");
const reach = computeReachable(map, SPAWN_ANCHOR.x, SPAWN_ANCHOR.y);
t("a new game places one bag on a reachable tile", () => {
  for (let i = 0; i < 25; i++) {
    const s = fresh();
    truthy(s.coinBag, "coinBag must exist");
    eq(s.coinBag.taken, false);
    truthy(canWalk(map, s.coinBag.x, s.coinBag.y), `walkable at ${s.coinBag.x},${s.coinBag.y}`);
    truthy(reach[s.coinBag.y * MAP_W + s.coinBag.x], "must be reachable from the gate");
  }
});
t("the bag never shares a tile with an NPC", () => {
  for (let i = 0; i < 25; i++) {
    const s = fresh();
    const key = `${s.coinBag.x},${s.coinBag.y}`;
    for (const [id, p] of Object.entries(s.npcs)) {
      truthy(`${p.x},${p.y}` !== key, `${id} sits on the bag`);
    }
  }
});
t("an older save missing new fields has them filled in", () => {
  const s = fresh();
  delete s.coinBag; delete s.lives; delete s.hearts; delete s.ghost;
  const added = S.ensureExtras(s, map);
  eq(added.sort().join(","), "coinBag,ghost,hearts,lives");
  truthy(reach[s.coinBag.y * MAP_W + s.coinBag.x], "bag reachable");
  eq(s.lives, S.MAX_LIVES);
  eq(s.hearts.length, S.HEART_PICKUPS);
  truthy(s.ghost && typeof s.ghost.x === "number", "ghost placed");
  eq(S.ensureExtras(s, map).length, 0, "second call is a no-op");
});
t("the pickup amount is ten", () => eq(S.COIN_BAG_AMOUNT, 10));

console.log("\nlives, hearts and the ghost");
t("a new game starts on three hearts", () => {
  const s = fresh();
  eq(s.lives, 3);
  eq(S.MAX_LIVES, 3);
});
t("five heart pickups, all reachable and untaken", () => {
  for (let i = 0; i < 20; i++) {
    const s = fresh();
    eq(s.hearts.length, 5);
    for (const h of s.hearts) {
      eq(h.taken, false);
      truthy(canWalk(map, h.x, h.y), `walkable at ${h.x},${h.y}`);
      truthy(reach[h.y * MAP_W + h.x], "reachable");
    }
  }
});
t("hearts do not overlap each other, NPCs or the bag", () => {
  for (let i = 0; i < 20; i++) {
    const s = fresh();
    const seen = new Set([`${s.coinBag.x},${s.coinBag.y}`]);
    for (const p of Object.values(s.npcs)) seen.add(`${p.x},${p.y}`);
    for (const h of s.hearts) {
      const k = `${h.x},${h.y}`;
      truthy(!seen.has(k), `heart collides at ${k}`);
      seen.add(k);
    }
  }
});
t("losing a life reports death only on the last one", () => {
  const s = fresh();
  eq(S.loseLife(s), false); eq(s.lives, 2);
  eq(S.loseLife(s), false); eq(s.lives, 1);
  eq(S.loseLife(s), true);  eq(s.lives, 0);
  eq(S.loseLife(s), true, "never goes negative"); eq(s.lives, 0);
});
t("gaining a life caps at three", () => {
  const s = fresh();
  s.lives = 1;
  eq(S.gainLife(s), true); eq(s.lives, 2);
  eq(S.gainLife(s), true); eq(s.lives, 3);
  eq(S.gainLife(s), false, "already full"); eq(s.lives, 3);
});
t("the ghost spawns far from the player", () => {
  for (let i = 0; i < 20; i++) {
    const s = fresh();
    const d = Math.hypot(s.ghost.x - s.player.x, s.ghost.y - s.player.y);
    truthy(d >= 1400, `only ${Math.round(d)}px away`);
  }
});
t("respawnTile keeps its distance and stays walkable", () => {
  const s = fresh();
  for (let i = 0; i < 40; i++) {
    const t2 = S.respawnTile(map, s.player.x, s.player.y);
    truthy(canWalk(map, t2.x, t2.y), "walkable");
    truthy(reach[t2.y * MAP_W + t2.x], "reachable");
    const d = Math.hypot((t2.x + 0.5) * 32 - s.player.x, (t2.y + 0.5) * 32 - s.player.y);
    truthy(d >= 1400, `only ${Math.round(d)}px away`);
  }
});
t("lives, hearts and ghost survive a save", () => {
  const s = fresh();
  S.loseLife(s);
  s.hearts[0].taken = true;
  s.ghost.x = 999; s.ghost.dir = "left";
  S.save(s);
  const r = S.load();
  eq(r.lives, 2);
  eq(r.hearts[0].taken, true);
  eq(r.hearts[1].taken, false);
  eq(r.ghost.x, 999);
  eq(r.ghost.dir, "left");
  S.clearSave();
});

console.log("\nquest markers");
const { questMark } = await import("../js/render.js");
t("shows ! before the quest is taken", () => {
  const s = fresh();
  eq(questMark(s, "cook"), "!");
});
t("shows ? once taken but not finished", () => {
  const s = fresh();
  s.quests.cook.state = S.QUEST.ACCEPTED;
  eq(questMark(s, "cook"), "?");
});
t("shows nothing once completed", () => {
  const s = fresh();
  s.quests.cook.state = S.QUEST.DONE;
  eq(questMark(s, "cook"), null);
});
t("warlock marks follow trial state", () => {
  const s = fresh();
  eq(questMark(s, "warlock"), "!", "trial available");
  s.warlock.trials[0].state = S.TRIAL.ACCEPTED;
  eq(questMark(s, "warlock"), "?", "trial accepted");
  for (let i = 0; i < 7; i++) S.completeTrial(s, i);
  eq(questMark(s, "warlock"), null, "all trials done");
});

console.log("\nsaving");
t("save and load round-trips", () => {
  const s = fresh();
  S.assignTeam(s, "cook", S.TEAM.PLAYER);
  s.quests.cook.state = S.QUEST.ACCEPTED;
  s.quests.jester.sweetTalkFailed = true;
  S.completeTrial(s, 0);
  s.player.x = 1234; s.player.y = 5678; s.player.dir = "left";
  truthy(S.save(s), "save should succeed");

  const r = S.load();
  truthy(r, "load should return a state");
  eq(r.faction, "pirate");
  eq(r.player.x, 1234);
  eq(r.player.dir, "left");
  eq(r.teams.cook, S.TEAM.PLAYER);
  eq(r.quests.cook.state, "accepted");
  eq(r.quests.jester.sweetTalkFailed, true);
  eq(r.warlock.trials[0].state, S.TRIAL.DONE);
  eq(r.warlock.trials[1].state, S.TRIAL.AVAILABLE);
  eq(r.npcs.cook.x, s.npcs.cook.x, "npc positions must persist");
  eq(r.coinBag.x, s.coinBag.x, "bag position must persist");
});
t("a taken bag stays taken across a save", () => {
  const s = fresh();
  s.coinBag.taken = true;
  S.save(s);
  eq(S.load().coinBag.taken, true);
  S.clearSave();
});
t("hasSave reflects reality", () => {
  S.clearSave();
  eq(S.hasSave(), false);
  S.save(fresh());
  eq(S.hasSave(), true);
  S.clearSave();
});
t("a corrupt save is rejected rather than crashing", () => {
  store.set(S.SAVE_KEY, "{not json");
  eq(S.load(), null);
  store.set(S.SAVE_KEY, JSON.stringify({ version: 99 }));
  eq(S.load(), null);
  S.clearSave();
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
