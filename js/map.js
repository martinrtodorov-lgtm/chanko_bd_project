// Procedural terrain for the Chanko map. Deterministic: the same seed always
// produces the same world, so a save can restore positions without storing tiles.

export const TILE = 32;
export const MAP_W = 240;
export const MAP_H = 132;

export const VIEW_W = 1280;
export const VIEW_H = 704;

export const T = {
  VOID: 0,
  WATER: 1,
  GRASS: 2,
  TREE: 3,
  FOREST: 4,
  ROAD: 5,
  FENCE: 6,
  GATE: 7,
  TAVERN: 8,
  POOL: 9,
  HOUSE: 10,
  LAWN: 11,
};

const IMPASSABLE = new Set([T.VOID, T.WATER, T.TREE, T.FENCE, T.TAVERN, T.POOL, T.HOUSE]);
export const isPassable = (t) => !IMPASSABLE.has(t);

export const PALETTE = {
  [T.VOID]: "#000000",
  [T.WATER]: "#2f5d8a",
  [T.GRASS]: "#4c7f42",
  [T.TREE]: "#1e4527",
  [T.FOREST]: "#3d6b38",
  [T.ROAD]: "#9a8763",
  [T.FENCE]: "#6b4a2a",
  [T.GATE]: "#b3a07a",
  [T.TAVERN]: "#7b4a2c",
  [T.POOL]: "#3f9ec4",
  [T.HOUSE]: "#8d5a38",
  [T.LAWN]: "#5f9a52",
};

// --- Region boundaries -----------------------------------------------------

export const REGION = {
  RIVER_X1: 11,          // 0..11   impassable water, full height
  FOREST_X0: 12,
  FOREST_X1: 59,         // walkable maze
  ROAD_X0: 60,
  ROAD_X1: 67,           // vertical road, full height
  VILLA_X0: 68,          // fence line, against the road
  VILLA_Y0: 22,          // one screen of grass above
  VILLA_Y1: 109,         // one screen of grass below
  GATE_Y0: 64,           // opening in the left fence, map vertical centre
  GATE_Y1: 68,
};

// --- Seeded RNG ------------------------------------------------------------

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Generation ------------------------------------------------------------

export function generateMap(seed = 20260731) {
  const rng = mulberry32(seed);
  const tiles = new Uint8Array(MAP_W * MAP_H);
  const set = (x, y, t) => {
    if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) tiles[y * MAP_W + x] = t;
  };
  const rect = (x0, y0, x1, y1, t) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t);
  };
  const R = REGION;

  // Base: grass everywhere
  rect(0, 0, MAP_W - 1, MAP_H - 1, T.GRASS);

  // River — impassable, full left edge
  rect(0, 0, R.RIVER_X1, MAP_H - 1, T.WATER);

  // Forest — walkable floor, scattered impassable trees forming a light maze
  rect(R.FOREST_X0, 0, R.FOREST_X1, MAP_H - 1, T.FOREST);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = R.FOREST_X0; x <= R.FOREST_X1; x++) {
      // Denser in the middle of the belt, thinner near the road so the player
      // can always find a way through.
      const edge = Math.min(x - R.FOREST_X0, R.FOREST_X1 - x);
      const density = edge < 3 ? 0.06 : 0.3;
      if (rng() < density) set(x, y, T.TREE);
    }
  }
  // Carve horizontal corridors so the belt is never a wall
  for (let y = 6; y < MAP_H; y += 13) {
    const wobble = Math.floor(rng() * 3) - 1;
    for (let x = R.FOREST_X0; x <= R.FOREST_X1; x++) set(x, y + wobble, T.FOREST);
  }

  // Road — vertical, full height
  rect(R.ROAD_X0, 0, R.ROAD_X1, MAP_H - 1, T.ROAD);

  // Grass above and below the villa, with occasional trees
  for (const [y0, y1] of [[0, R.VILLA_Y0 - 1], [R.VILLA_Y1 + 1, MAP_H - 1]]) {
    for (let y = y0; y <= y1; y++) {
      for (let x = R.VILLA_X0; x < MAP_W; x++) {
        if (rng() < 0.04) set(x, y, T.TREE);
      }
    }
  }

  // Villa fence: left (against the road), top, bottom, right (map edge)
  for (let y = R.VILLA_Y0; y <= R.VILLA_Y1; y++) {
    set(R.VILLA_X0, y, T.FENCE);
    set(MAP_W - 1, y, T.FENCE);
  }
  for (let x = R.VILLA_X0; x < MAP_W; x++) {
    set(x, R.VILLA_Y0, T.FENCE);
    set(x, R.VILLA_Y1, T.FENCE);
  }
  // Gate — opening in the left fence, aligned with the road
  for (let y = R.GATE_Y0; y <= R.GATE_Y1; y++) set(R.VILLA_X0, y, T.GATE);

  // Villa interior starts as clean grass
  rect(R.VILLA_X0 + 1, R.VILLA_Y0 + 1, MAP_W - 2, R.VILLA_Y1 - 1, T.GRASS);

  // Upper half: tavern, and the pool to its right
  rect(84, 30, 132, 56, T.TAVERN);
  rect(150, 32, 206, 56, T.POOL);

  // Lower half: four small houses, each with a lawn beneath it
  const houseY0 = 72, houseY1 = 86, lawnY1 = 100;
  const houseXs = [82, 120, 158, 196];
  for (const hx of houseXs) {
    rect(hx, houseY0, hx + 24, houseY1, T.HOUSE);
    rect(hx, houseY1 + 1, hx + 24, lawnY1, T.LAWN);
  }
  // Occasional impassable small trees between the houses
  for (let i = 0; i < houseXs.length - 1; i++) {
    const gapX = houseXs[i] + 25;
    const gapW = houseXs[i + 1] - gapX;
    for (let y = houseY0; y <= lawnY1; y++) {
      if (rng() < 0.22) set(gapX + Math.floor(rng() * gapW), y, T.TREE);
    }
  }

  return { width: MAP_W, height: MAP_H, tiles };
}

// --- Queries ---------------------------------------------------------------

export function tileAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return T.VOID;
  return map.tiles[y * map.width + x];
}

export function canWalk(map, x, y) {
  return isPassable(tileAt(map, x, y));
}

// Flood fill from a start tile. NPCs and the player may only occupy tiles in
// this set, which guarantees nothing spawns inside a sealed forest pocket.
export function computeReachable(map, sx, sy) {
  const reach = new Uint8Array(map.width * map.height);
  if (!canWalk(map, sx, sy)) return reach;
  const stack = [sy * map.width + sx];
  reach[stack[0]] = 1;
  while (stack.length) {
    const p = stack.pop();
    const x = p % map.width, y = (p / map.width) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const np = ny * map.width + nx;
      if (reach[np] || !canWalk(map, nx, ny)) continue;
      reach[np] = 1;
      stack.push(np);
    }
  }
  return reach;
}

// The gate is the canonical connected-region anchor.
export const SPAWN_ANCHOR = { x: REGION.ROAD_X1, y: REGION.GATE_Y0 + 1 };
