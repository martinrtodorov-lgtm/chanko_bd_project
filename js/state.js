// Game state, spawning, and persistence.

import { generateMap, computeReachable, MAP_W, TILE, REGION, SPAWN_ANCHOR } from "./map.js";

export const SAVE_KEY = "chanko.save.v1";
export const TEAM = { PLAYER: "player", ENEMY: "enemy", NEUTRAL: "neutral" };
export const QUEST = { NONE: "not-accepted", ACCEPTED: "accepted", DONE: "completed" };
export const TRIAL = { LOCKED: "locked", AVAILABLE: "available", ACCEPTED: "accepted", DONE: "completed" };

export const PLAYER_TEAM_CAP = 8;   // Chanko + 7
export const ENEMY_TEAM_CAP = 8;
export const DC_OWN_TEAM = 13;
export const DC_OPPOSING = 18;
export const DC_WARLOCK_HINT = 15;

// The Warlock stands inside the villa, just below the tavern — a fixed,
// findable landmark, since he gates the win condition.
export const WARLOCK_TILE = { x: 108, y: 62 };

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
    const label = npc["npc-label"];
    teams[label] = TEAM.NEUTRAL;
    npcs[label] = pickTile();
    quests[label] = { state: QUEST.NONE, sweetTalkFailed: false };
  }

  return {
    version: 1,
    faction,
    player: {
      x: (SPAWN_ANCHOR.x + 0.5) * TILE,
      y: (SPAWN_ANCHOR.y + 0.5) * TILE,
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
