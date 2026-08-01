// Entry point: boot, screen flow, input, movement, and the render loop.

import { generateMap, canWalk, TILE, VIEW_W, VIEW_H } from "./map.js";
import { loadAssets } from "./assets.js";
import {
  createState, load, save, hasSave, ensureCoinBag, WARLOCK_TILE, COIN_BAG_AMOUNT,
} from "./state.js";
import { cameraFor, drawWorld, drawEntities } from "./render.js";
import {
  showFactionSelect, showTeams, showInfo, showEnding, showMessage, isOverlayOpen,
} from "./ui.js";
import { interactWith } from "./interact.js";

const SPEED = 350;              // px per second
const BODY_W = 20, BODY_H = 14; // collision box around the feet
const WALK_FRAME_MS = 130;
const ATTACK_MS = 320;
const INTERACT_RANGE = 58;

const screens = {
  start: document.getElementById("start-screen"),
  game: document.getElementById("game-screen"),
};
const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");
const loadingEl = document.getElementById("loading");

let assets = null;
let map = null;
let state = null;
let running = false;

const keys = new Set();
const anim = { action: "idle", frame: 0, walkClock: 0, attackClock: 0, clock: 0 };

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.remove("is-active"));
  screens[name].classList.add("is-active");
}

// --- Collision -------------------------------------------------------------

function freeAt(cx, cy) {
  const half = { w: BODY_W / 2, h: BODY_H / 2 };
  const corners = [
    [cx - half.w, cy - half.h], [cx + half.w, cy - half.h],
    [cx - half.w, cy + half.h], [cx + half.w, cy + half.h],
  ];
  return corners.every(([px, py]) =>
    canWalk(map, Math.floor(px / TILE), Math.floor(py / TILE))
  );
}

// --- Interaction target ----------------------------------------------------

/** Nearest thing E would act on: an NPC to talk to, or the coin bag to pick up. */
function nearestTarget() {
  const px = state.player.x, py = state.player.y;
  let best = null, bestD = INTERACT_RANGE;

  const consider = (label, tx, ty) => {
    const d = Math.hypot((tx + 0.5) * TILE - px, (ty + 0.5) * TILE - py);
    if (d < bestD) { bestD = d; best = label; }
  };
  for (const [label, pos] of Object.entries(state.npcs)) consider(label, pos.x, pos.y);
  consider("warlock", WARLOCK_TILE.x, WARLOCK_TILE.y);
  if (state.coinBag && !state.coinBag.taken) {
    consider("coin-bag", state.coinBag.x, state.coinBag.y);
  }
  return best;
}

// --- Loop ------------------------------------------------------------------

let last = 0;
function frame(now) {
  if (!running) return;
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;

  if (!isOverlayOpen()) update(dt);
  draw();
  requestAnimationFrame(frame);
}

function update(dt) {
  anim.clock += dt * 1000;   // drives the quest-marker bob

  let dx = 0, dy = 0;
  if (keys.has("ArrowLeft")) dx -= 1;
  if (keys.has("ArrowRight")) dx += 1;
  if (keys.has("ArrowUp")) dy -= 1;
  if (keys.has("ArrowDown")) dy += 1;

  if (anim.attackClock > 0) {
    anim.attackClock -= dt * 1000;
    anim.action = "attack";
    anim.frame = anim.attackClock > ATTACK_MS / 2 ? 0 : 1;
    if (anim.attackClock <= 0) anim.action = "idle";
    return; // rooted while swinging
  }

  if (dx || dy) {
    // Facing: horizontal wins ties. The left and right frame sets are the only
    // fully consistent ones, so diagonals should prefer them.
    if (dx < 0) state.player.dir = "left";
    else if (dx > 0) state.player.dir = "right";
    else if (dy < 0) state.player.dir = "up";
    else if (dy > 0) state.player.dir = "down";

    const len = Math.hypot(dx, dy) || 1;
    const step = SPEED * dt;
    const nx = state.player.x + (dx / len) * step;
    const ny = state.player.y + (dy / len) * step;

    if (freeAt(nx, state.player.y)) state.player.x = nx;
    if (freeAt(state.player.x, ny)) state.player.y = ny;

    anim.action = "walk";
    anim.walkClock += dt * 1000;
    if (anim.walkClock >= WALK_FRAME_MS) {
      anim.walkClock -= WALK_FRAME_MS;
      anim.frame = (anim.frame + 1) % 4;
    }
  } else {
    anim.action = "idle";
    anim.frame = 0;
    anim.walkClock = 0;
  }
}

function draw() {
  const cam = cameraFor(state.player);
  drawWorld(ctx, map, cam, assets.tileArt);
  drawEntities(ctx, state, assets, cam, anim, isOverlayOpen() ? null : nearestTarget(), map);
}

// --- Input -----------------------------------------------------------------

const MOVE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

window.addEventListener("keydown", async (e) => {
  if (MOVE_KEYS.has(e.key)) {
    if (!isOverlayOpen()) { e.preventDefault(); keys.add(e.key); }
    return;
  }
  if (!running || isOverlayOpen()) return;

  const k = e.key.toLowerCase();
  if (k === "a") {
    e.preventDefault();
    if (anim.attackClock <= 0) anim.attackClock = ATTACK_MS;
  } else if (k === "e") {
    e.preventDefault();
    const label = nearestTarget();
    if (!label) return;
    keys.clear();
    if (label === "coin-bag") {
      state.coinBag.taken = true;
      save(state);
      await showMessage("Gold!", `You have found ${COIN_BAG_AMOUNT} gold!`);
      return;
    }
    const won = await interactWith(state, assets, label);
    save(state);
    if (won) endGame();
  } else if (k === "t") {
    e.preventDefault();
    keys.clear();
    await showTeams(state, assets);
    save(state);
  } else if (k === "i") {
    e.preventDefault();
    keys.clear();
    await showInfo(assets.info);
  }
});

window.addEventListener("keyup", (e) => keys.delete(e.key));
window.addEventListener("blur", () => keys.clear());
window.addEventListener("beforeunload", () => { if (state && running) save(state); });

// --- Flow ------------------------------------------------------------------

function endGame() {
  running = false;
  save(state);
  showEnding();
}

function beginPlay(loaded) {
  state = loaded;
  ensureCoinBag(state, map);
  hud.classList.add("is-visible");
  showScreen("game");
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
  setInterval(() => { if (running) save(state); }, 5000);
}

async function newGame() {
  const faction = await showFactionSelect();
  const fresh = createState(faction, assets.npcs, map);
  await showTeams(fresh, assets, { forced: true });
  save(fresh);
  beginPlay(fresh);
}

async function boot() {
  const startBtn = document.getElementById("btn-start");
  const continueBtn = document.getElementById("btn-continue");
  startBtn.disabled = true;
  continueBtn.disabled = true;

  assets = await loadAssets((done, total) => {
    loadingEl.textContent = `Loading ${done} / ${total}`;
  });
  loadingEl.textContent = "";

  // The world is built once, with decor, and shared by spawning and rendering.
  map = generateMap(undefined, assets.decor);

  startBtn.disabled = false;
  continueBtn.disabled = !hasSave();

  startBtn.addEventListener("click", newGame);
  continueBtn.addEventListener("click", () => {
    const saved = load();
    if (saved) beginPlay(saved);
  });
}

canvas.width = VIEW_W;
canvas.height = VIEW_H;
boot();
