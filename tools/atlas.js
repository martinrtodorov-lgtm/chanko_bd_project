// Split a transparent-background atlas into individual items.
//   node tools/atlas.js <atlas.png> <outDir> [--gap 3] [--minArea 120]
//
// Unlike tools/extract.js this keys on the alpha channel rather than a flat
// background colour, which is what these tilesets ship with.
import fs from "fs";
import path from "path";
import { PNG } from "pngjs";

const args = process.argv.slice(2);
const [src, outDir] = args;
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : Number(args[i + 1]);
};
const GAP = flag("gap", 3);
const MIN_AREA = flag("minArea", 120);

const png = PNG.sync.read(fs.readFileSync(src));
const { width: W, height: H, data } = png;

// Opaque mask
const fg = new Uint8Array(W * H);
for (let p = 0; p < W * H; p++) fg[p] = data[p * 4 + 3] > 24 ? 1 : 0;

// Connected components
const seen = new Uint8Array(W * H);
const stack = new Int32Array(W * H);
let boxes = [];
for (let p0 = 0; p0 < W * H; p0++) {
  if (!fg[p0] || seen[p0]) continue;
  let sp = 0; stack[sp++] = p0; seen[p0] = 1;
  let minX = W, minY = H, maxX = 0, maxY = 0, area = 0;
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % W, y = (p / W) | 0;
    area++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const np = ny * W + nx;
      if (fg[np] && !seen[np]) { seen[np] = 1; stack[sp++] = np; }
    }
  }
  boxes.push({ minX, minY, maxX, maxY, area });
}

// Merge boxes that nearly touch, so an item split by a highlight stays whole
const near = (a, b) =>
  a.minX - GAP <= b.maxX && b.minX - GAP <= a.maxX &&
  a.minY - GAP <= b.maxY && b.minY - GAP <= a.maxY;
let merged = true;
while (merged) {
  merged = false;
  outer:
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (near(boxes[i], boxes[j])) {
        boxes[i] = {
          minX: Math.min(boxes[i].minX, boxes[j].minX),
          minY: Math.min(boxes[i].minY, boxes[j].minY),
          maxX: Math.max(boxes[i].maxX, boxes[j].maxX),
          maxY: Math.max(boxes[i].maxY, boxes[j].maxY),
          area: boxes[i].area + boxes[j].area,
        };
        boxes.splice(j, 1); merged = true; break outer;
      }
    }
  }
}

boxes = boxes.filter((b) => b.area >= MIN_AREA);
const BAND = 24;
boxes.sort((a, b) => {
  const ba = Math.floor(a.minY / BAND), bb = Math.floor(b.minY / BAND);
  return ba !== bb ? ba - bb : a.minX - b.minX;
});

fs.mkdirSync(outDir, { recursive: true });
const base = path.basename(src, path.extname(src)).toLowerCase();
const manifest = [];

boxes.forEach((b, i) => {
  const w = b.maxX - b.minX + 1, h = b.maxY - b.minY + 1;
  const out = new PNG({ width: w, height: h });
  let opaque = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const si = ((b.minY + y) * W + (b.minX + x)) * 4, di = (y * w + x) * 4;
    out.data[di] = data[si]; out.data[di + 1] = data[si + 1];
    out.data[di + 2] = data[si + 2]; out.data[di + 3] = data[si + 3];
    if (data[si + 3] > 24) opaque++;
  }
  const name = `${base}-${String(i).padStart(2, "0")}.png`;
  fs.writeFileSync(path.join(outDir, name), PNG.sync.write(out));
  // `fill` is the opaque fraction of the bounding box. A single object is
  // mostly solid; a cluster of separate items that got merged is mostly gaps,
  // which lets the packaging step drop it.
  manifest.push({ name, w, h, fill: +(opaque / (w * h)).toFixed(3) });
});

fs.writeFileSync(path.join(outDir, `${base}-manifest.json`), JSON.stringify(manifest, null, 2));

// Contact sheet for review
const COLS = 10, CELL = 110;
const rows = Math.ceil(boxes.length / COLS) || 1;
const sheet = new PNG({ width: COLS * CELL, height: rows * CELL });
for (let i = 0; i < sheet.data.length; i += 4) {
  sheet.data[i] = 26; sheet.data[i + 1] = 26; sheet.data[i + 2] = 34; sheet.data[i + 3] = 255;
}
boxes.forEach((b, idx) => {
  const w = b.maxX - b.minX + 1, h = b.maxY - b.minY + 1;
  const cx = (idx % COLS) * CELL, cy = Math.floor(idx / COLS) * CELL;
  const s = Math.min((CELL - 20) / w, (CELL - 20) / h, 2);
  const dw = Math.max(1, (w * s) | 0), dh = Math.max(1, (h * s) | 0);
  const ox = cx + ((CELL - dw) >> 1), oy = cy + ((CELL - dh) >> 1);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const si = ((b.minY + (y / s | 0)) * W + (b.minX + (x / s | 0))) * 4;
    if (data[si + 3] <= 24) continue;
    const di = ((oy + y) * sheet.width + (ox + x)) * 4;
    sheet.data[di] = data[si]; sheet.data[di + 1] = data[si + 1]; sheet.data[di + 2] = data[si + 2];
  }
  for (let x = 0; x < Math.min(idx + 1, CELL - 6); x++) {
    const di = ((cy + 4) * sheet.width + cx + 3 + x) * 4;
    sheet.data[di] = 255; sheet.data[di + 1] = 210; sheet.data[di + 2] = 60;
  }
});
fs.writeFileSync(path.join(outDir, `${base}-contact.png`), PNG.sync.write(sheet));

console.log(`${base}: ${boxes.length} items`);
