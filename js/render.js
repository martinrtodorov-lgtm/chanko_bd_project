// Canvas rendering: terrain, entities, camera. The camera never clamps, so the
// player sees black void past the map edge.

import { TILE, VIEW_W, VIEW_H, T, PALETTE, tileAt } from "./map.js";
import { playerFrame, npcFrame } from "./assets.js";
import { WARLOCK_TILE, npcSpriteKey } from "./state.js";

const SPRITE_H = 64;          // on-screen height for Chanko and NPCs
const WARLOCK_H = 76;

// Cheap deterministic hash so tile decoration never flickers between frames.
const hash = (x, y) => {
  let h = (x * 73856093) ^ (y * 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const shade = (hex, amt) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.max(0, Math.min(255, Math.round(v + amt)))
  );
  return `rgb(${c[0]},${c[1]},${c[2]})`;
};

export function cameraFor(player) {
  return { x: Math.round(player.x - VIEW_W / 2), y: Math.round(player.y - VIEW_H / 2) };
}

function drawTile(ctx, map, tx, ty, sx, sy) {
  const t = tileAt(map, tx, ty);
  const base = PALETTE[t] || "#000";

  if (t === T.VOID) {
    ctx.fillStyle = "#000";
    ctx.fillRect(sx, sy, TILE, TILE);
    return;
  }

  const n = hash(tx, ty);
  ctx.fillStyle = base;
  ctx.fillRect(sx, sy, TILE, TILE);

  switch (t) {
    case T.GRASS:
    case T.FOREST:
    case T.LAWN: {
      // Sparse blades for texture
      ctx.fillStyle = shade(base, n > 0.5 ? 14 : -12);
      const bx = sx + ((n * 24) | 0), by = sy + ((hash(ty, tx) * 24) | 0);
      ctx.fillRect(bx, by, 3, 5);
      break;
    }
    case T.WATER: {
      ctx.fillStyle = shade(base, 18);
      const wy = sy + ((n * 26) | 0);
      ctx.fillRect(sx + 2, wy, 14, 2);
      ctx.fillStyle = shade(base, -16);
      ctx.fillRect(sx + 16, sy + ((hash(tx, ty + 7) * 26) | 0), 12, 2);
      break;
    }
    case T.ROAD:
    case T.GATE: {
      ctx.fillStyle = shade(base, n > 0.6 ? -18 : 10);
      ctx.fillRect(sx + ((n * 22) | 0), sy + ((hash(ty, tx) * 22) | 0), 5, 4);
      break;
    }
    case T.TREE: {
      // Trunk and canopy sitting on whatever the surrounding ground is
      const ground = tileAt(map, tx, ty + 1) === T.FOREST ? PALETTE[T.FOREST] : PALETTE[T.GRASS];
      ctx.fillStyle = ground;
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = "#5a3a20";
      ctx.fillRect(sx + 14, sy + 20, 5, 10);
      ctx.fillStyle = shade(PALETTE[T.TREE], n > 0.5 ? 10 : -8);
      ctx.beginPath();
      ctx.arc(sx + 16, sy + 15, 12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case T.FENCE: {
      ctx.fillStyle = PALETTE[T.GRASS];
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = base;
      ctx.fillRect(sx, sy + 8, TILE, 5);
      ctx.fillRect(sx, sy + 20, TILE, 5);
      ctx.fillStyle = shade(base, -22);
      ctx.fillRect(sx + 12, sy + 2, 6, TILE - 4);
      break;
    }
    case T.POOL: {
      ctx.fillStyle = shade(base, 22);
      ctx.fillRect(sx, sy + ((n * 28) | 0), TILE, 2);
      break;
    }
    case T.HOUSE:
    case T.TAVERN: {
      // Outline the silhouette so multi-tile buildings read as buildings
      ctx.fillStyle = shade(base, -26);
      if (tileAt(map, tx, ty - 1) !== t) ctx.fillRect(sx, sy, TILE, 4);
      if (tileAt(map, tx, ty + 1) !== t) ctx.fillRect(sx, sy + TILE - 4, TILE, 4);
      if (tileAt(map, tx - 1, ty) !== t) ctx.fillRect(sx, sy, 4, TILE);
      if (tileAt(map, tx + 1, ty) !== t) ctx.fillRect(sx + TILE - 4, sy, 4, TILE);
      // Windows
      if (n > 0.82 && tileAt(map, tx, ty - 1) === t && tileAt(map, tx, ty + 1) === t) {
        ctx.fillStyle = "#f0d089";
        ctx.fillRect(sx + 10, sy + 10, 12, 12);
      }
      break;
    }
  }
}

export function drawWorld(ctx, map, cam) {
  const t0x = Math.floor(cam.x / TILE) - 1;
  const t0y = Math.floor(cam.y / TILE) - 1;
  const cols = Math.ceil(VIEW_W / TILE) + 2;
  const rows = Math.ceil(VIEW_H / TILE) + 2;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const tx = t0x + rx, ty = t0y + ry;
      drawTile(ctx, map, tx, ty, tx * TILE - cam.x, ty * TILE - cam.y);
    }
  }
}

function drawSprite(ctx, img, cx, footY, height) {
  if (!img) return;
  const w = Math.round((img.width / img.height) * height);
  ctx.drawImage(img, Math.round(cx - w / 2), Math.round(footY - height), w, height);
}

export function drawEntities(ctx, state, assets, cam, anim, nearbyLabel) {
  const list = [];

  for (const [label, pos] of Object.entries(state.npcs)) {
    list.push({
      label,
      cx: (pos.x + 0.5) * TILE,
      footY: (pos.y + 1) * TILE,
      img: npcFrame(assets, npcSpriteKey(state, label)),
      h: SPRITE_H,
    });
  }
  list.push({
    label: "warlock",
    cx: (WARLOCK_TILE.x + 0.5) * TILE,
    footY: (WARLOCK_TILE.y + 1) * TILE,
    img: npcFrame(assets, "warlock"),
    h: WARLOCK_H,
  });
  list.push({
    label: null,
    cx: state.player.x,
    footY: state.player.y + TILE / 2,
    img: playerFrame(assets, state.player.dir, anim.action, anim.frame),
    h: SPRITE_H,
  });

  list.sort((a, b) => a.footY - b.footY);

  for (const e of list) {
    const sx = e.cx - cam.x, sy = e.footY - cam.y;
    if (sx < -120 || sy < -160 || sx > VIEW_W + 120 || sy > VIEW_H + 160) continue;

    // Soft contact shadow
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(sx, sy - 3, e.h * 0.2, e.h * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawSprite(ctx, e.img, sx, sy, e.h);

    if (e.label && e.label === nearbyLabel) {
      ctx.save();
      ctx.fillStyle = "#ffd23c";
      ctx.font = "bold 18px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("E", sx, sy - e.h - 10);
      ctx.restore();
    }
  }
}
