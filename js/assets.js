// Image loading. Everything is fetched up front so the game loop never waits.

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

export async function loadAssets(onProgress = () => {}) {
  const [spriteIndex, npcs, warlock, info] = await Promise.all([
    fetch("./assets/sprites/sprites.json").then((r) => r.json()),
    fetch("./data/npcs.json").then((r) => r.json()),
    fetch("./data/warlock.json").then((r) => r.json()),
    fetch("./data/info.json").then((r) => r.json()),
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

  return { spriteIndex, npcs, warlock, info, images };
}

// Frame lookup helpers ------------------------------------------------------

export function playerFrame(assets, dir, action, frame) {
  const idx = assets.spriteIndex.player;
  if (action === "walk") return assets.images[idx.walk[dir][frame % 4]];
  if (action === "attack") return assets.images[idx.attack[dir][frame % 2]];
  return assets.images[idx.idle];
}

export function npcFrame(assets, spriteKey) {
  return assets.images[assets.spriteIndex.npcs[spriteKey].idle];
}

export function portrait(assets, ref) {
  return assets.images[ref];
}
