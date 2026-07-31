// Image loading. Everything is fetched up front so the game loop never waits.

import { T } from "./map.js";

const cache = new Map();

function loadImage(src) {
  if (cache.has(src)) return cache.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
  cache.set(src, p);
  return p;
}

export const DIRS = ["up", "down", "left", "right"];

// Optional single-tile artwork, 32x32 each. Absent files fall back to the
// procedural look. The files under assets/tiles/*/ are multi-item atlases, not
// single tiles, so they are consumed by tools/atlas.js instead of loaded here.
export const TILE_ART_PATHS = {
  [T.FLOOR]: "assets/tiles/tile-floor.png",
  [T.WALL]: "assets/tiles/tile-wall.png",
  [T.DOOR]: "assets/tiles/tile-door.png",
  [T.DECK]: "assets/tiles/tile-deck.png",
};

function loadOptional(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function loadAssets(onProgress = () => {}) {
  const [spriteIndex, npcs, warlock, info, decor] = await Promise.all([
    fetch("./assets/sprites/sprites.json").then((r) => r.json()),
    fetch("./data/npcs.json").then((r) => r.json()),
    fetch("./data/warlock.json").then((r) => r.json()),
    fetch("./data/info.json").then((r) => r.json()),
    fetch("./assets/decor/decor.json").then((r) => r.json()).catch(() => null),
  ]);

  const paths = new Set();
  paths.add(spriteIndex.player.idle);
  for (const d of DIRS) {
    spriteIndex.player.walk[d].forEach((p) => paths.add(p));
    spriteIndex.player.attack[d].forEach((p) => paths.add(p));
  }
  for (const npc of Object.values(spriteIndex.npcs)) paths.add(npc.idle);
  for (const npc of npcs) paths.add(npc["npc-portrait-reference"]);
  paths.add(warlock["npc-portrait-reference"]);
  if (decor) {
    for (const v of Object.values(decor)) {
      if (Array.isArray(v)) v.forEach((it) => paths.add(it.src));
      else if (v && v.src) paths.add(v.src);
    }
  }

  const list = [...paths];
  let done = 0;
  const images = {};
  await Promise.all(
    list.map((p) =>
      loadImage(`./${p}`)
        .then((img) => { images[p] = img; })
        .catch(() => { images[p] = null; })
        .finally(() => onProgress(++done, list.length))
    )
  );

  // Nicknames drive the on-map nameplates.
  const nicknames = {};
  for (const npc of npcs) nicknames[npc["npc-label"]] = npc["npc-nickname"] || npc["npc-label"];
  nicknames.warlock = warlock["npc-nickname"] || "Warlock";

  // Optional tile artwork, keyed by tile type.
  const tileArt = {};
  await Promise.all(
    Object.entries(TILE_ART_PATHS).map(([t, p]) =>
      loadOptional(`./${p}`).then((img) => { if (img) tileArt[t] = img; })
    )
  );

  return { spriteIndex, npcs, warlock, info, decor, images, nicknames, tileArt };
}

// Frame lookup helpers ------------------------------------------------------

export function playerFrame(assets, dir, action, frame) {
  const idx = assets.spriteIndex.player;
  if (action === "walk") {
    const frames = idx.walk[dir];
    return assets.images[frames[frame % frames.length]];
  }
  if (action === "attack") {
    const frames = idx.attack[dir];
    return assets.images[frames[frame % frames.length]];
  }
  return assets.images[idx.idle];
}

export function npcFrame(assets, spriteKey) {
  return assets.images[assets.spriteIndex.npcs[spriteKey].idle];
}

export function portrait(assets, ref) {
  return assets.images[ref];
}
