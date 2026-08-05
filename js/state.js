// Game state, spawning, and persistence.

import { generateMap, computeReachable, MAP_W, TILE, REGION, SPAWN_ANCHOR } from "./map.js";

export const SAVE_KEY = "chanko.save.v1";
export const TEAM = { PLAYER: "player", ENEMY: "enemy", NEUTRAL: "neutral" };
export const QUEST = { NONE: "not-accepted", ACCEPTED: "accepted", DONE: "completed" };
export const TRIAL = { LOCKED: "locked", AVAILABLE: "available", ACCEPTED: "accepted", DONE: "completed" };

export const PLAYER_TEAM_CAP = 8;   // Chanko + 7
export const ENEMY_TEAM_CAP = 8;
export const COIN_BAG_AMOUNT = 10;
export const MAX_LIVES = 3;
export const HEART_PICKUPS = 5;
export const DC_WISDOM_SAVE = 10;
export const DC_OWN_TEAM = 13;
export const DC_OPPOSING = 18;
export const DC_WARLOCK_HINT = 15;

// The Warlock stands inside the villa, just below the tavern — a fixed,
// findable landmark, since he gates the win condition.
export const WARLOCK_TILE = { x: 108, y: 62 };

/** Every tile you can actually stand on, as flat indices. */
function openTiles(map) {
  const reach = computeReachable(map, SPAWN_ANCHOR.x, SPAWN_ANCHOR.y);
  const open = [];
  for (let i = 0; i < reach.length; i++) if (reach[i]) open.push(i);
  return open;
}

const asTile = (p) => ({ x: p % MAP_W, y: (p / MAP_W) | 0 });

/**
 * A reachable tile at least `minAway` pixels from (fromX, fromY), used to drop
 * the ghost back onto the map somewhere the player is not standing.
 */
export function respawnTile(map, fromX, fromY, minAway = 1400) {
  const open = openTiles(map);
  for (let attempt = 0; attempt < 400; attempt++) {
    const t = asTile(open[(Math.random() * open.length) | 0]);
    const d = Math.hypot((t.x + 0.5) * TILE - fromX, (t.y + 0.5) * TILE - fromY);
    if (d >= minAway) return t;
  }
  return asTile(open[(Math.random() * open.length) | 0]);
}

export function createState(faction, npcData, map = generateMap()) {
  const reach = computeReachable(map, SPAWN_ANCHOR.x, SPAWN_ANCHOR.y);

  // Collect every reachable tile, then deal out distinct spawn points.
  const open = [];
  for (let i = 0; i < reach.length; i++) {
    if (reach[i]) open.push(i);
  }

  const taken = new Set([WARLOCK_TILE.y * MAP_W + WARLOCK_TILE.x]);
  const pickTile = () => {
    for (let attempt = 0; attempt < 500; attempt++) {
      const p = open[(Math.random() * open.length) | 0];
      if (taken.has(p)) continue;
      taken.add(p);
      return { x: p % MAP_W, y: (p / MAP_W) | 0 };
    }
    const p = open[(Math.random() * open.length) | 0];
    return { x: p % MAP_W, y: (p / MAP_W) | 0 };
  };

  const teams = {};
  const npcs = {};
  const quests = {};
  for (const npc of npcData) {
    const id = npc.id;
    teams[id] = TEAM.NEUTRAL;
    npcs[id] = pickTile();
    quests[id] = { state: QUEST.NONE, sweetTalkFailed: false };
  }

  const playerX = (SPAWN_ANCHOR.x + 0.5) * TILE;
  const playerY = (SPAWN_ANCHOR.y + 0.5) * TILE;
  const ghostTile = respawnTile(map, playerX, playerY);

  return {
    version: 1,
    faction,
    coinBag: { ...pickTile(), taken: false },
    lives: MAX_LIVES,
    hearts: Array.from({ length: HEART_PICKUPS }, () => ({ ...pickTile(), taken: false })),
    ghost: {
      x: (ghostTile.x + 0.5) * TILE,
      y: (ghostTile.y + 0.5) * TILE,
      dir: "down",
      frame: 0,
    },
    player: {
      x: playerX,
      y: playerY,
      dir: "right",
    },
    teams,
    npcs,
    quests,
    warlock: {
      trials: Array.from({ length: 7 }, (_, i) => ({
        state: i === 0 ? TRIAL.AVAILABLE : TRIAL.LOCKED,
        hintUnlocked: false,
      })),
    },
    won: false,
  };
}

/**
 * Fills in anything a save predates — the coin bag, lives, heart pickups, the
 * ghost. Returns the names of the fields it added, so an older save keeps its
 * quest progress instead of being rejected.
 */
export function ensureExtras(state, map) {
  const added = [];
  const open = openTiles(map);
  const pick = () => asTile(open[(Math.random() * open.length) | 0]);

  if (!state.coinBag) { state.coinBag = { ...pick(), taken: false }; added.push("coinBag"); }
  if (typeof state.lives !== "number") { state.lives = MAX_LIVES; added.push("lives"); }
  if (!Array.isArray(state.hearts)) {
    state.hearts = Array.from({ length: HEART_PICKUPS }, () => ({ ...pick(), taken: false }));
    added.push("hearts");
  }
  if (!state.ghost) {
    const t = respawnTile(map, state.player.x, state.player.y);
    state.ghost = { x: (t.x + 0.5) * TILE, y: (t.y + 0.5) * TILE, dir: "down", frame: 0 };
    added.push("ghost");
  }
  return added;
}

/** Drops a life. Returns true when that was the last one. */
export function loseLife(state) {
  state.lives = Math.max(0, state.lives - 1);
  return state.lives === 0;
}

export function gainLife(state, n = 1) {
  const before = state.lives;
  state.lives = Math.min(MAX_LIVES, state.lives + n);
  return state.lives !== before;
}

// --- Team helpers ----------------------------------------------------------

export const playerTeamCount = (state) =>
  1 + Object.values(state.teams).filter((t) => t === TEAM.PLAYER).length;

export const enemyTeamCount = (state) =>
  Object.values(state.teams).filter((t) => t === TEAM.ENEMY).length;

export const neutralCount = (state) =>
  Object.values(state.teams).filter((t) => t === TEAM.NEUTRAL).length;

export const canCloseTeams = (state) => neutralCount(state) === 0;

/** Returns true on success, or a reason string when the cap blocks the move. */
export function assignTeam(state, label, team) {
  if (team === TEAM.PLAYER && state.teams[label] !== TEAM.PLAYER) {
    if (playerTeamCount(state) >= PLAYER_TEAM_CAP) return "player-full";
  }
  if (team === TEAM.ENEMY && state.teams[label] !== TEAM.ENEMY) {
    if (enemyTeamCount(state) >= ENEMY_TEAM_CAP) return "enemy-full";
  }
  state.teams[label] = team;
  return true;
}

/** Which sprite an NPC renders with, given the player's chosen faction. */
export function npcSpriteKey(state, label) {
  if (label === "warlock") return "warlock";
  const opposing = state.faction === "pirate" ? "viking" : "pirate";
  return state.teams[label] === TEAM.PLAYER ? state.faction : opposing;
}

export const dcFor = (state, label) =>
  state.teams[label] === TEAM.PLAYER ? DC_OWN_TEAM : DC_OPPOSING;

// --- Warlock helpers -------------------------------------------------------

/** Index of the trial currently accepted or available, or -1 when all done. */
export function currentTrialIndex(state) {
  return state.warlock.trials.findIndex((t) => t.state !== TRIAL.DONE);
}

export function completeTrial(state, i) {
  state.warlock.trials[i].state = TRIAL.DONE;
  const next = state.warlock.trials[i + 1];
  if (next) next.state = TRIAL.AVAILABLE;
  else state.won = true;
}

// --- Persistence -----------------------------------------------------------

export function save(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.version === 1 && s.player && s.teams ? s : null;
  } catch {
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

export const hasSave = () => load() !== null;
