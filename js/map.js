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
  DECK: 12,
  WALL: 13,
  FLOOR: 14,
  DOOR: 15,
};

const IMPASSABLE = new Set([
  T.VOID, T.WATER, T.TREE, T.FENCE, T.TAVERN, T.POOL, T.HOUSE, T.WALL,
]);
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
  [T.DECK]: "#9a9a9a",
  [T.WALL]: "#8d5a38",
  [T.FLOOR]: "#a8845c",
  [T.DOOR]: "#4a2f19",
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

// Pool: same centre as before (178, 44), half the width and half the height.
export const POOL = { x0: 164, y0: 38, x1: 191, y1: 49 };

// The tavern is a building you can walk into, like the houses.
export const TAVERN = {
  x0: 84, y0: 30, x1: 132, y1: 56,
  doorOffset: 22,   // from the left wall
  doorW: 3,
};

// Four small houses along the lower half of the villa.
export const HOUSE_XS = [82, 120, 158, 196];
export const HOUSE = {
  y0: 72,
  y1: 86,
  w: 24,
  doorOffset: 11,   // doorway starts this far in from the left wall
  doorW: 2,
  lawnY1: 100,
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

/**
 * @param seed  deterministic world seed
 * @param decor optional catalogue from assets/decor/decor.json; when supplied,
 *              furniture is scattered indoors and props are set around the pool
 */
export function generateMap(seed = 20260731, decor = null) {
  const rng = mulberry32(seed);
  const tiles = new Uint8Array(MAP_W * MAP_H);
  const blocked = new Set();
  const props = [];
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

  // Upper half: the tavern, walled and enterable like the houses, and the pool
  // to its right — half size, ringed by a paved deck.
  rect(TAVERN.x0, TAVERN.y0, TAVERN.x1, TAVERN.y1, T.WALL);
  rect(TAVERN.x0 + 1, TAVERN.y0 + 1, TAVERN.x1 - 1, TAVERN.y1 - 1, T.FLOOR);
  for (let d = 0; d < TAVERN.doorW; d++) {
    set(TAVERN.x0 + TAVERN.doorOffset + d, TAVERN.y1, T.DOOR);
  }

  rect(POOL.x0 - 2, POOL.y0 - 2, POOL.x1 + 2, POOL.y1 + 2, T.DECK);
  rect(POOL.x0, POOL.y0, POOL.x1, POOL.y1, T.POOL);

  // Lower half: four small houses, each walled with a doorway on the south
  // side and its own floor, plus a lawn beneath it.
  for (const hx of HOUSE_XS) {
    rect(hx, HOUSE.y0, hx + HOUSE.w, HOUSE.y1, T.WALL);
    rect(hx + 1, HOUSE.y0 + 1, hx + HOUSE.w - 1, HOUSE.y1 - 1, T.FLOOR);
    for (let d = 0; d < HOUSE.doorW; d++) {
      set(hx + HOUSE.doorOffset + d, HOUSE.y1, T.DOOR);
    }
    rect(hx, HOUSE.y1 + 1, hx + HOUSE.w, HOUSE.lawnY1, T.LAWN);
  }
  // Occasional impassable small trees between the houses
  for (let i = 0; i < HOUSE_XS.length - 1; i++) {
    const gapX = HOUSE_XS[i] + HOUSE.w + 1;
    const gapW = HOUSE_XS[i + 1] - gapX;
    for (let y = HOUSE.y0; y <= HOUSE.lawnY1; y++) {
      if (rng() < 0.22) set(gapX + Math.floor(rng() * gapW), y, T.TREE);
    }
  }

  // --- Decor ---------------------------------------------------------------

  const idx = (x, y) => y * MAP_W + x;
  const tileOf = (x, y) => tiles[idx(x, y)];

  /** Reserve the tiles a prop stands on so the player cannot walk through it. */
  const occupy = (tx, ty, w) => {
    const span = Math.max(1, Math.ceil(w / TILE));
    const x0 = tx - ((span - 1) >> 1);
    for (let i = 0; i < span; i++) blocked.add(idx(x0 + i, ty));
  };

  const fits = (tx, ty, w, isClear) => {
    const span = Math.max(1, Math.ceil(w / TILE));
    const x0 = tx - ((span - 1) >> 1);
    for (let i = 0; i < span; i++) {
      const x = x0 + i;
      if (!isClear(x, ty) || blocked.has(idx(x, ty))) return false;
    }
    return true;
  };

  const LARGE_AREA = 1500;   // roughly a bed, table, wardrobe or bar counter

  /**
   * Furnish a building. Large pieces are pushed against the walls the way real
   * rooms are arranged; small clutter goes anywhere. Picking uniformly from the
   * whole catalogue would bury the furniture under trinkets, since the atlases
   * hold far more small items than big ones.
   */
  const furnish = (items, building, counts, doorX0, doorX1) => {
    if (!items || !items.length) return;
    const inner = { x0: building.x0 + 1, y0: building.y0 + 1, x1: building.x1 - 1, y1: building.y1 - 1 };

    const large = items.filter((i) => i.w * i.h >= LARGE_AREA);
    const small = items.filter((i) => i.w * i.h < LARGE_AREA);

    const isClear = (x, y) => {
      if (tileOf(x, y) !== T.FLOOR) return false;
      // Keep the doorway and the strip in front of it walkable
      if (x >= doorX0 - 1 && x <= doorX1 + 1 && y >= inner.y1 - 2) return false;
      return true;
    };

    // Tiles hugging a wall, for the big pieces
    const perimeter = [];
    for (let x = inner.x0 + 1; x <= inner.x1 - 1; x++) {
      perimeter.push({ x, y: inner.y0 }, { x, y: inner.y0 + 1 }, { x, y: inner.y1 });
    }
    for (let y = inner.y0; y <= inner.y1; y++) {
      perimeter.push({ x: inner.x0 + 1, y }, { x: inner.x1 - 1, y });
    }

    const scatter = (pool, count, spots) => {
      if (!pool.length) return;
      let placed = 0;
      for (let a = 0; a < count * 60 && placed < count; a++) {
        const item = pool[(rng() * pool.length) | 0];
        let tx, ty;
        if (spots) {
          const s = spots[(rng() * spots.length) | 0];
          tx = s.x; ty = s.y;
        } else {
          tx = inner.x0 + ((rng() * (inner.x1 - inner.x0 + 1)) | 0);
          ty = inner.y0 + ((rng() * (inner.y1 - inner.y0 + 1)) | 0);
        }
        if (!fits(tx, ty, item.w, isClear)) continue;
        props.push({ src: item.src, tx, ty, w: item.w, h: item.h });
        occupy(tx, ty, item.w);
        placed++;
      }
    };

    scatter(large, counts.large, perimeter);
    scatter(small, counts.small, null);
  };

  if (decor) {
    for (const hx of HOUSE_XS) {
      const door0 = hx + HOUSE.doorOffset, door1 = door0 + HOUSE.doorW - 1;
      furnish(
        decor.house,
        { x0: hx, y0: HOUSE.y0, x1: hx + HOUSE.w, y1: HOUSE.y1 },
        { large: 8, small: 7 },
        door0, door1
      );
    }
    const tDoor0 = TAVERN.x0 + TAVERN.doorOffset;
    furnish(decor.tavern, TAVERN, { large: 30, small: 26 }, tDoor0, tDoor0 + TAVERN.doorW - 1);

    // The ship sits in the middle of the pool; the water already blocks movement.
    if (decor.ship) {
      props.push({
        src: decor.ship.src,
        tx: ((POOL.x0 + POOL.x1) / 2) | 0,
        ty: ((POOL.y0 + POOL.y1) / 2) | 0,
        w: decor.ship.w, h: decor.ship.h, float: true,
      });
    }

    // Flags, anchor and barrels around the poolside deck.
    const deckSpots = [];
    for (let x = POOL.x0 - 2; x <= POOL.x1 + 2; x++) {
      deckSpots.push({ x, y: POOL.y0 - 2 }, { x, y: POOL.y1 + 2 });
    }
    for (let y = POOL.y0 - 1; y <= POOL.y1 + 1; y++) {
      deckSpots.push({ x: POOL.x0 - 2, y }, { x: POOL.x1 + 2, y });
    }
    const deckClear = (x, y) => tileOf(x, y) === T.DECK;
    const placeOn = (item, n) => {
      if (!item) return;
      for (let k = 0, guard = 0; k < n && guard < 400; guard++) {
        const s = deckSpots[(rng() * deckSpots.length) | 0];
        if (!fits(s.x, s.y, item.w, deckClear)) continue;
        props.push({ src: item.src, tx: s.x, ty: s.y, w: item.w, h: item.h });
        occupy(s.x, s.y, item.w);
        k++;
      }
    };
    if (decor.flag && decor.flag.length) {
      for (let i = 0; i < 4; i++) placeOn(decor.flag[(rng() * decor.flag.length) | 0], 1);
    }
    placeOn(decor.anchor, 2);
    placeOn(decor.barrels, 4);
  }

  return { width: MAP_W, height: MAP_H, tiles, blocked, props };
}

// --- Queries ---------------------------------------------------------------

export function tileAt(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return T.VOID;
  return map.tiles[y * map.width + x];
}

export function canWalk(map, x, y) {
  if (!isPassable(tileAt(map, x, y))) return false;
  return !(map.blocked && map.blocked.has(y * map.width + x));
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
