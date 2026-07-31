// Render a tile region at full resolution with props composited, to check
// decor placement. Tiles use flat palette colours (the in-game procedural
// detail lives in the browser renderer).
//   node tools/scene-preview.js <x0> <y0> <x1> <y1> <out.png>
import fs from "fs";
import { PNG } from "pngjs";
import { generateMap, PALETTE, tileAt, TILE } from "../js/map.js";

const [x0, y0, x1, y1, out] = process.argv.slice(2);
const X0 = +x0, Y0 = +y0, X1 = +x1, Y1 = +y1;

const decor = JSON.parse(fs.readFileSync("assets/decor/decor.json", "utf8"));
const map = generateMap(undefined, decor);

const W = (X1 - X0) * TILE, H = (Y1 - Y0) * TILE;
const img = new PNG({ width: W, height: H });
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

for (let ty = Y0; ty < Y1; ty++) {
  for (let tx = X0; tx < X1; tx++) {
    const [r, g, b] = hex(PALETTE[tileAt(map, tx, ty)] || "#ff00ff");
    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        const i = (((ty - Y0) * TILE + py) * W + ((tx - X0) * TILE + px)) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    }
  }
}

const cache = new Map();
const load = (src) => {
  if (!cache.has(src)) cache.set(src, PNG.sync.read(fs.readFileSync(src)));
  return cache.get(src);
};

let drawn = 0;
const sorted = [...map.props].sort((a, b) => a.ty - b.ty);
for (const p of sorted) {
  if (p.tx < X0 - 8 || p.tx > X1 + 8 || p.ty < Y0 - 8 || p.ty > Y1 + 8) continue;
  const sprite = load(p.src);
  const cx = (p.tx + 0.5) * TILE;
  const footY = p.float ? (p.ty + 0.5) * TILE + p.h / 2 : (p.ty + 1) * TILE;
  const ox = Math.round(cx - p.w / 2) - X0 * TILE;
  const oy = Math.round(footY - p.h) - Y0 * TILE;

  for (let y = 0; y < sprite.height; y++) {
    for (let x = 0; x < sprite.width; x++) {
      const si = (y * sprite.width + x) * 4;
      const a = sprite.data[si + 3] / 255;
      if (a === 0) continue;
      const dx = ox + x, dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue;
      const di = (dy * W + dx) * 4;
      for (let c = 0; c < 3; c++) {
        img.data[di + c] = Math.round(sprite.data[si + c] * a + img.data[di + c] * (1 - a));
      }
    }
  }
  drawn++;
}

fs.mkdirSync("tools/preview", { recursive: true });
fs.writeFileSync(out, PNG.sync.write(img));
console.log(`${out}  ${W}x${H}px, ${drawn} props drawn`);
