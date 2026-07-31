// Render the generated map to a PNG for visual review, plus a reachability
// report. Run: node tools/map-preview.js [pixelsPerTile]
import fs from "fs";
import { PNG } from "pngjs";
import {
  generateMap, computeReachable, canWalk, tileAt,
  PALETTE, T, MAP_W, MAP_H, VIEW_W, VIEW_H, TILE, SPAWN_ANCHOR,
} from "../js/map.js";

const PPT = Number(process.argv[2] || 5);
const map = generateMap();
const reach = computeReachable(map, SPAWN_ANCHOR.x, SPAWN_ANCHOR.y);

const W = MAP_W * PPT, H = MAP_H * PPT;
const png = new PNG({ width: W, height: H });

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

for (let y = 0; y < MAP_H; y++) {
  for (let x = 0; x < MAP_W; x++) {
    const t = tileAt(map, x, y);
    let [r, g, b] = hex(PALETTE[t] || "#ff00ff");
    // Tint walkable-but-unreachable pockets magenta so they stand out.
    if (canWalk(map, x, y) && !reach[y * MAP_W + x]) { r = 255; g = 0; b = 200; }
    for (let py = 0; py < PPT; py++) {
      for (let px = 0; px < PPT; px++) {
        const i = ((y * PPT + py) * W + (x * PPT + px)) * 4;
        png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
      }
    }
  }
}

// Screen grid overlay: one cell per viewport, to verify the 36-screen budget.
const sw = VIEW_W / TILE, sh = VIEW_H / TILE;
for (let x = 0; x <= MAP_W; x += sw) {
  for (let y = 0; y < H; y++) {
    const i = (y * W + Math.min(x * PPT, W - 1)) * 4;
    png.data[i] = 255; png.data[i + 1] = 255; png.data[i + 2] = 255; png.data[i + 3] = 255;
  }
}
for (let y = 0; y <= MAP_H; y += sh) {
  for (let x = 0; x < W; x++) {
    const i = (Math.min(y * PPT, H - 1) * W + x) * 4;
    png.data[i] = 255; png.data[i + 1] = 255; png.data[i + 2] = 255; png.data[i + 3] = 255;
  }
}

fs.mkdirSync("tools/preview", { recursive: true });
fs.writeFileSync("tools/preview/map.png", PNG.sync.write(png));

// --- Report ---------------------------------------------------------------

let walkable = 0, reachable = 0;
const byType = {};
for (let y = 0; y < MAP_H; y++) {
  for (let x = 0; x < MAP_W; x++) {
    const t = tileAt(map, x, y);
    byType[t] = (byType[t] || 0) + 1;
    if (canWalk(map, x, y)) { walkable++; if (reach[y * MAP_W + x]) reachable++; }
  }
}
const NAME = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k]));
const pct = (n, d) => ((n / d) * 100).toFixed(1) + "%";

console.log(`map      : ${MAP_W}x${MAP_H} tiles = ${(MAP_W / sw) * (MAP_H / sh)} screens`);
console.log(`walkable : ${walkable} (${pct(walkable, MAP_W * MAP_H)} of map)`);
console.log(`reachable: ${reachable} (${pct(reachable, walkable)} of walkable)`);
console.log(`stranded : ${walkable - reachable} tiles walled off (shown magenta)`);
console.log("tiles    :", Object.entries(byType)
  .sort((a, b) => b[1] - a[1])
  .map(([t, n]) => `${NAME[t]}=${n}`).join(" "));
