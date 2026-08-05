// Entry point: boot, screen flow, input, movement, and the render loop.

import { generateMap, canWalk, TILE, VIEW_W, VIEW_H } from "./map.js";
import { loadAssets } from "./assets.js";
import {
  createState, load, save, hasSave, ensureExtras, respawnTile, loseLife, gainLife,
  ghostSpeed, WARLOCK_TILE, COIN_BAG_AMOUNT, MAX_LIVES, DC_WISDOM_SAVE,
  PLAYER_SPEED as SPEED, GHOST_TOUCH, SLASH_REACH,
} from "./state.js";
import { cameraFor, drawWorld, drawEntities } from "./render.js";
import {
  showFactionSelect, showTeams, showInfo, showEnding, showCurseEnding,
  showMessage, showDialogue, isOverlayOpen,
} from "./ui.js";
import { interactWith } from "./interact.js";

const BODY_W = 20, BODY_H = 14; // collision box around the feet
const WALK_FRAME_MS = 130;
const ATTACK_MS = 320;
const INTERACT_RANGE = 58;

// Chase tuning lives in state.js so it can be tested without a browser.

const screens = {
  start: document.getElementById("start-screen"),
  game: document.getElementById("game-screen"),
};
const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");
const livesEl = document.getElementById("lives");
const loadingEl = document.getElementById("loading");

const HEART_SVG = `<svg class="heart" viewBox="0 0 32 30" xmlns="http://www.w3.org/2000/svg">
  <path d="M16 28C6 21 1 15.5 1 9.8 1 5 4.6 1.5 9 1.5c2.9 0 5.4 1.6 7 4 1.6-2.4 4.1-4 7-4 4.4 0 8 3.5 8 8.3C31 15.5 26 21 16 28z"
        fill="#e0384a" stroke="#7d1622" stroke-width="2" stroke-linejoin="round"/>
</svg>`;

function renderLives() {
  if (livesEl.childElementCount !== MAX_LIVES) {
    livesEl.innerHTML = HEART_SVG.repeat(MAX_LIVES);
  }
  const lives = state ? state.lives : MAX_LIVES;
  [...livesEl.children].forEach((el, i) => el.classList.toggle("is-lost", i >= lives));
}

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

function freeAt(cx, cy, w = BODY_W, h = BODY_H) {
  const hw = w / 2, hh = h / 2;
  const corners = [
    [cx - hw, cy - hh], [cx + hw, cy - hh],
    [cx - hw, cy + hh], [cx + hw, cy + hh],
  ];
  return corners.every(([px, py]) =>
    canWalk(map, Math.floor(px / TILE), Math.floor(py / TILE))
  );
}

/** Slide along whichever axis is not blocked, so nothing sticks to walls. */
function moveWithSlide(pos, dx, dy, step) {
  const len = Math.hypot(dx, dy) || 1;
  const nx = pos.x + (dx / len) * step;
  const ny = pos.y + (dy / len) * step;
  let moved = false;
  if (freeAt(nx, pos.y)) { pos.x = nx; moved = true; }
  if (freeAt(pos.x, ny)) { pos.y = ny; moved = true; }
  return moved;
}

function sendGhostAway() {
  const t = respawnTile(map, state.player.x, state.player.y);
  state.ghost.x = (t.x + 0.5) * TILE;
  state.ghost.y = (t.y + 0.5) * TILE;
}

function updateGhost(dt) {
  const g = state.ghost;
  if (!g) return;

  // She always knows exactly where he is — the screen only decides her pace.
  const dx = state.player.x - g.x;
  const dy = state.player.y - g.y;

  moveWithSlide(g, dx, dy, ghostSpeed(g, state.player) * dt);

  // Face travel direction, horizontal winning ties like the player.
  if (Math.abs(dx) >= Math.abs(dy)) g.dir = dx < 0 ? "left" : "right";
  else g.dir = dy < 0 ? "up" : "down";

  g.frameClock = (g.frameClock || 0) + dt * 1000;
  if (g.frameClock >= WALK_FRAME_MS) {
    g.frameClock -= WALK_FRAME_MS;
    g.frame = ((g.frame | 0) + 1) % 4;
  }

  if (Math.hypot(g.x - state.player.x, g.y - state.player.y) < GHOST_TOUCH) {
    onGhostCaughtPlayer();
  }
}

/** True when a swing in `dir` would land on the ghost. */
function slashHitsGhost() {
  const g = state.ghost;
  if (!g) return false;
  const dx = g.x - state.player.x, dy = g.y - state.player.y;
  if (Math.hypot(dx, dy) > SLASH_REACH) return false;
  switch (state.player.dir) {
    case "left": return dx < 0 && Math.abs(dy) <= SLASH_REACH * 0.7;
    case "right": return dx > 0 && Math.abs(dy) <= SLASH_REACH * 0.7;
    case "up": return dy < 0 && Math.abs(dx) <= SLASH_REACH * 0.7;
    default: return dy > 0 && Math.abs(dx) <= SLASH_REACH * 0.7;
  }
}

// --- Interaction target ----------------------------------------------------

/** Nearest thing E would act on: an NPC, the coin bag, or a heart. */
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
  if (state.hearts) {
    state.hearts.forEach((h, i) => { if (!h.taken) consider(`heart-${i}`, h.x, h.y); });
  }
  return best;
}

// --- Damage and death ------------------------------------------------------

let resolvingDeath = false;

function onGhostCaughtPlayer() {
  if (resolvingDeath) return;
  const dead = loseLife(state);
  renderLives();
  sendGhostAway();
  save(state);
  if (dead) {
    resolvingDeath = true;
    handleDeath();
  }
}

/**
 * Out of hearts. One Wisdom save stands between Chanko and the curse; passing
 * it hands back a single heart and play continues.
 */
async function handleDeath() {
  keys.clear();
  const choice = await showDialogue({
    portraitSrc: "",
    name: "Wisdom saving throw",
    profession: "",
    text: `Your last heart is gone. Roll a d20. Wisdom check, DC ${DC_WISDOM_SAVE}. Report your result honestly.`,
    options: [
      { id: "success", label: "Success", note: `met or beat DC ${DC_WISDOM_SAVE}` },
      { id: "failure", label: "Failure", note: `under DC ${DC_WISDOM_SAVE}` },
    ],
    dismissible: false,
  });

  if (choice === "success") {
    gainLife(state, 1);
    renderLives();
    sendGhostAway();
    save(state);
    resolvingDeath = false;
    return;
  }

  await showCurseEnding();

  // Quest and trial progress is tied to real-world codes, so it survives.
  // Only the hearts and the ghost are reset before returning to the menu.
  state.lives = MAX_LIVES;
  sendGhostAway();
  save(state);
  resolvingDeath = false;
  returnToStart();
}

function returnToStart() {
  running = false;
  keys.clear();
  livesEl.classList.remove("is-visible");
  hud.classList.remove("is-visible");
  showScreen("start");
  document.getElementById("btn-continue").disabled = !hasSave();
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
    updateGhost(dt);   // the ghost keeps closing in while Chanko swings
    return;            // but he is rooted mid-swing
  }

  if (dx || dy) {
    // Facing: horizontal wins ties. The left and right frame sets are the only
    // fully consistent ones, so diagonals should prefer them.
    if (dx < 0) state.player.dir = "left";
    else if (dx > 0) state.player.dir = "right";
    else if (dy < 0) state.player.dir = "up";
    else if (dy > 0) state.player.dir = "down";

    moveWithSlide(state.player, dx, dy, SPEED * dt);

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

  updateGhost(dt);
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
    if (anim.attackClock <= 0) {
      anim.attackClock = ATTACK_MS;
      // Landing the swing banishes the ghost instead of costing a heart.
      if (slashHitsGhost()) {
        sendGhostAway();
        save(state);
      }
    }
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
    if (label.startsWith("heart-")) {
      const heart = state.hearts[+label.slice(6)];
      if (!heart || heart.taken) return;
      heart.taken = true;
      const healed = gainLife(state);
      renderLives();
      save(state);
      await showMessage(
        "A heart restored",
        healed
          ? `You feel your strength return. ${state.lives} of ${MAX_LIVES} hearts remain.`
          : "You are already at full strength, but you pocket it all the same."
      );
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
  ensureExtras(state, map);
  resolvingDeath = false;
  renderLives();
  livesEl.classList.add("is-visible");
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
