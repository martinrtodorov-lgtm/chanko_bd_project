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

function drawTile(ctx, map, tx, ty, sx, sy, art) {
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

  // Supplied tile artwork wins over the procedural look, when it exists.
  const img = art && art[t];
  if (img) {
    ctx.drawImage(img, sx, sy, TILE, TILE);
    return;
  }

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
    case T.DECK: {
      // Paved apron around the pool
      ctx.fillStyle = shade(base, n > 0.5 ? 10 : -10);
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.strokeStyle = shade(base, -28);
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);
      break;
    }
    case T.FLOOR: {
      // Floorboards
      ctx.fillStyle = shade(base, -14);
      ctx.fillRect(sx, sy + 10, TILE, 1);
      ctx.fillRect(sx, sy + 22, TILE, 1);
      ctx.fillStyle = shade(base, n > 0.5 ? 8 : -6);
      ctx.fillRect(sx + ((n * 20) | 0), sy + 2, 6, 6);
      break;
    }
    case T.DOOR: {
      ctx.fillStyle = shade(PALETTE[T.WALL], -10);
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = base;
      ctx.fillRect(sx + 3, sy + 2, TILE - 6, TILE - 2);
      ctx.fillStyle = "#e8c477";
      ctx.fillRect(sx + TILE - 10, sy + 16, 4, 4);
      break;
    }
    case T.WALL:
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

export function drawWorld(ctx, map, cam, art) {
  const t0x = Math.floor(cam.x / TILE) - 1;
  const t0y = Math.floor(cam.y / TILE) - 1;
  const cols = Math.ceil(VIEW_W / TILE) + 2;
  const rows = Math.ceil(VIEW_H / TILE) + 2;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const tx = t0x + rx, ty = t0y + ry;
      drawTile(ctx, map, tx, ty, tx * TILE - cam.x, ty * TILE - cam.y, art);
    }
  }
}

function drawSprite(ctx, img, cx, footY, height) {
  if (!img) return;
  const w = Math.round((img.width / img.height) * height);
  ctx.drawImage(img, Math.round(cx - w / 2), Math.round(footY - height), w, height);
}

export function drawEntities(ctx, state, assets, cam, anim, nearbyLabel, map) {
  const list = [];

  // Static props: furniture indoors, ship and dockside clutter by the pool.
  if (map && map.props) {
    for (const p of map.props) {
      list.push({
        prop: true,
        img: assets.images[p.src],
        cx: (p.tx + 0.5) * TILE,
        footY: p.float ? (p.ty + 0.5) * TILE + p.h / 2 : (p.ty + 1) * TILE,
        w: p.w,
        h: p.h,
      });
    }
  }

  for (const [label, pos] of Object.entries(state.npcs)) {
    list.push({
      label,
      name: assets.nicknames[label] || label,
      cx: (pos.x + 0.5) * TILE,
      footY: (pos.y + 1) * TILE,
      img: npcFrame(assets, npcSpriteKey(state, label)),
      h: SPRITE_H,
    });
  }
  list.push({
    label: "warlock",
    name: assets.nicknames.warlock || "Warlock",
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
    const pad = e.prop ? Math.max(e.w, e.h) : 160;
    if (sx < -pad || sy < -pad || sx > VIEW_W + pad || sy > VIEW_H + pad) continue;

    if (e.prop) {
      if (e.img) {
        ctx.drawImage(e.img, Math.round(sx - e.w / 2), Math.round(sy - e.h), e.w, e.h);
      }
      continue;
    }

    // Soft contact shadow
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(sx, sy - 3, e.h * 0.2, e.h * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawSprite(ctx, e.img, sx, sy, e.h);

    // Nameplate, so two NPCs sharing a skin stay tellable apart
    if (e.name) {
      const top = sy - e.h;
      ctx.save();
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const w = ctx.measureText(e.name).width + 12;
      ctx.fillStyle = "rgba(8, 6, 4, 0.72)";
      ctx.fillRect(sx - w / 2, top - 22, w, 17);
      ctx.strokeStyle = e.label === nearbyLabel ? "#ffd23c" : "rgba(107, 87, 58, 0.9)";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx - w / 2 + 0.5, top - 21.5, w - 1, 16);
      ctx.fillStyle = e.label === nearbyLabel ? "#ffd23c" : "#f2e9d8";
      ctx.fillText(e.name, sx, top - 13);
      ctx.restore();
    }

    if (e.label && e.label === nearbyLabel) {
      ctx.save();
      ctx.fillStyle = "#ffd23c";
      ctx.font = "bold 18px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("E", sx, sy - e.h - 30);
      ctx.restore();
    }
  }
}
