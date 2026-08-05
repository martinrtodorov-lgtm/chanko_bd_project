// Chroma-key a presentation sprite sheet, find each sprite as a connected
// island, trim it, and write individual PNGs + a manifest + a contact sheet.
//
//   node extract.js <sheet.png> <outDir> [--tol 12] [--minArea 900] [--gap 14]

import fs from "fs";
import path from "path";
import { PNG } from "pngjs";

const args = process.argv.slice(2);
const [srcPath, outDir] = args;
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : Number(args[i + 1]);
};

const TOL = flag("tol", 12);        // chroma-key tolerance around bg colour
const MIN_AREA = flag("minArea", 900); // drop specks smaller than this
const GAP = flag("gap", 14);        // merge boxes closer than this (sword vs body)

const png = PNG.sync.read(fs.readFileSync(srcPath));
const { width: W, height: H, data } = png;

// --- 1. Determine background colour from the border ring -------------------

const counts = new Map();
const sample = (x, y) => {
  const i = (y * W + x) * 4;
  const k = `${data[i]},${data[i + 1]},${data[i + 2]}`;
  counts.set(k, (counts.get(k) || 0) + 1);
};
for (let x = 0; x < W; x += 2) { sample(x, 1); sample(x, H - 2); }
for (let y = 0; y < H; y += 2) { sample(1, y); sample(W - 2, y); }
const bg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);

// --- 2. Foreground mask ----------------------------------------------------

const fg = new Uint8Array(W * H);
for (let p = 0; p < W * H; p++) {
  const i = p * 4;
  const d = Math.max(
    Math.abs(data[i] - bg[0]),
    Math.abs(data[i + 1] - bg[1]),
    Math.abs(data[i + 2] - bg[2])
  );
  fg[p] = d > TOL ? 1 : 0;
}

// --- 3. Connected components (8-way, iterative) ----------------------------

const seen = new Uint8Array(W * H);
const boxes = [];
const stack = new Int32Array(W * H);

for (let p0 = 0; p0 < W * H; p0++) {
  if (!fg[p0] || seen[p0]) continue;
  let sp = 0;
  stack[sp++] = p0;
  seen[p0] = 1;
  let minX = W, minY = H, maxX = 0, maxY = 0, area = 0;

  while (sp > 0) {
    const p = stack[--sp];
    const x = p % W, y = (p / W) | 0;
    area++;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const np = ny * W + nx;
        if (fg[np] && !seen[np]) { seen[np] = 1; stack[sp++] = np; }
      }
    }
  }
  if (area >= MIN_AREA) boxes.push({ minX, minY, maxX, maxY, area });
}

// --- 4. Merge boxes that nearly touch (detached swords, effect arcs) -------

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
        boxes.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
}

// --- 5. Classify: baked-in text labels are near-monochrome, sprites are not -

function colourfulness(box) {
  let colourful = 0, total = 0;
  for (let y = box.minY; y <= box.maxY; y++) {
    for (let x = box.minX; x <= box.maxX; x++) {
      const p = y * W + x;
      if (!fg[p]) continue;
      const i = p * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (sat > 0.18 && mx > 40) colourful++;
      total++;
    }
  }
  return total === 0 ? 0 : colourful / total;
}

for (const b of boxes) {
  b.w = b.maxX - b.minX + 1;
  b.h = b.maxY - b.minY + 1;
  b.colour = colourfulness(b);
  b.isText = b.colour < 0.06;
}

// Reading order: top-to-bottom in bands, then left-to-right.
const BAND = 60;
boxes.sort((a, b) => {
  const ba = Math.floor(a.minY / BAND), bb = Math.floor(b.minY / BAND);
  return ba !== bb ? ba - bb : a.minX - b.minX;
});

// --- 6. Write trimmed, alpha'd PNGs ---------------------------------------

fs.mkdirSync(outDir, { recursive: true });
const base = path.basename(srcPath, ".png");
const sprites = boxes.filter((b) => !b.isText);
const manifest = [];

sprites.forEach((b, idx) => {
  const out = new PNG({ width: b.w, height: b.h });
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const sp = (b.minY + y) * W + (b.minX + x);
      const si = sp * 4, di = (y * b.w + x) * 4;
      out.data[di] = data[si];
      out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2];
      out.data[di + 3] = fg[sp] ? 255 : 0;
    }
  }
  const name = `${base}-${String(idx).padStart(2, "0")}.png`;
  fs.writeFileSync(path.join(outDir, name), PNG.sync.write(out));
  manifest.push({ name, x: b.minX, y: b.minY, w: b.w, h: b.h });
});

fs.writeFileSync(
  path.join(outDir, `${base}-manifest.json`),
  JSON.stringify({ source: path.basename(srcPath), bg, sprites: manifest }, null, 2)
);

// --- 7. Contact sheet: every extracted sprite, numbered, for visual review --

const COLS = 8;
const CELL = 200;
const rows = Math.ceil(sprites.length / COLS);
const sheet = new PNG({ width: COLS * CELL, height: rows * CELL });
for (let i = 0; i < sheet.data.length; i += 4) {
  sheet.data[i] = 24; sheet.data[i + 1] = 24; sheet.data[i + 2] = 32; sheet.data[i + 3] = 255;
}
sprites.forEach((b, idx) => {
  const cx = (idx % COLS) * CELL, cy = Math.floor(idx / COLS) * CELL;
  const scale = Math.min((CELL - 16) / b.w, (CELL - 16) / b.h, 1);
  const dw = Math.max(1, Math.floor(b.w * scale)), dh = Math.max(1, Math.floor(b.h * scale));
  const ox = cx + ((CELL - dw) >> 1), oy = cy + ((CELL - dh) >> 1);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const sx = b.minX + Math.floor(x / scale), sy = b.minY + Math.floor(y / scale);
      const sp = sy * W + sx;
      if (!fg[sp]) continue;
      const si = sp * 4, di = ((oy + y) * sheet.width + (ox + x)) * 4;
      sheet.data[di] = data[si];
      sheet.data[di + 1] = data[si + 1];
      sheet.data[di + 2] = data[si + 2];
      sheet.data[di + 3] = 255;
    }
  }
  // index marker: a bar whose length encodes the index, cheap but readable
  for (let x = 0; x < Math.min(idx + 1, CELL - 8) ; x++) {
    const di = ((cy + 6) * sheet.width + (cx + 4 + x)) * 4;
    sheet.data[di] = 255; sheet.data[di + 1] = 210; sheet.data[di + 2] = 60;
  }
});
fs.writeFileSync(path.join(outDir, `${base}-contact.png`), PNG.sync.write(sheet));

console.log(`${base}: bg=rgb(${bg}) islands=${boxes.length} sprites=${sprites.length} text=${boxes.filter(b => b.isText).length}`);
sprites.forEach((b, i) => console.log(`  [${String(i).padStart(2)}] ${String(b.w).padStart(4)}x${String(b.h).padStart(4)} at (${b.minX},${b.minY})  colour=${b.colour.toFixed(2)}`));
