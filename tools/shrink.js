// Downscale packaged frames in place, capping height. Box filter with
// alpha-weighted averaging so edges don't pick up halos from transparent pixels.
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const REPO = "C:/Users/marti/dev/chanko_bd_project/assets/sprites";
const MAX_H = Number(process.argv[2] || 160);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    // only the packaged frames, never the original sheets
    return e.name.endsWith(".png") && !e.name.includes("-sprites") ? [p] : [];
  });
}

function shrink(file) {
  const src = PNG.sync.read(fs.readFileSync(file));
  if (src.height <= MAX_H) return 0;

  const scale = MAX_H / src.height;
  const W = Math.max(1, Math.round(src.width * scale));
  const H = MAX_H;
  const out = new PNG({ width: W, height: H });

  const sxStep = src.width / W;
  const syStep = src.height / H;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor(x * sxStep), x1 = Math.min(src.width, Math.ceil((x + 1) * sxStep));
      const y0 = Math.floor(y * syStep), y1 = Math.min(src.height, Math.ceil((y + 1) * syStep));
      let r = 0, g = 0, b = 0, a = 0, wsum = 0, n = 0;

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * src.width + sx) * 4;
          const al = src.data[i + 3];
          r += src.data[i] * al; g += src.data[i + 1] * al; b += src.data[i + 2] * al;
          wsum += al; a += al; n++;
        }
      }
      const di = (y * W + x) * 4;
      if (wsum > 0) {
        out.data[di] = Math.round(r / wsum);
        out.data[di + 1] = Math.round(g / wsum);
        out.data[di + 2] = Math.round(b / wsum);
      }
      // hard alpha threshold keeps the sprite silhouette crisp
      out.data[di + 3] = a / n >= 128 ? 255 : 0;
    }
  }

  const before = fs.statSync(file).size;
  fs.writeFileSync(file, PNG.sync.write(out));
  return before - fs.statSync(file).size;
}

let saved = 0, count = 0;
for (const f of walk(REPO)) {
  const s = shrink(f);
  if (s > 0) { saved += s; count++; }
}
console.log(`shrank ${count} frames to max height ${MAX_H}px, saved ${(saved / 1024 / 1024).toFixed(2)} MB`);
