// Copy extracted atlas items into assets/decor/ and write the catalogue the
// game loads. Run after tools/atlas.js.
import fs from "fs";
import path from "path";
import { PNG } from "pngjs";

const SRC = "tools/preview/atlas";
const DST = "assets/decor";

const GROUPS = [
  { key: "house", from: "interiorhouse", to: "house", minSide: 14 },
  { key: "tavern", from: "interiortavern", to: "tavern", minSide: 14 },
  { key: "flag", from: "flag", to: "pool", minSide: 10 },
  { key: "ship", from: "ship", to: "pool", minSide: 40, single: true },
  { key: "anchor", from: "anchor", to: "pool", minSide: 8, single: true },
  { key: "barrels", from: "barrels", to: "pool", minSide: 8, single: true },
];

const catalogue = {};

for (const g of GROUPS) {
  const dir = path.join(SRC, g.from);
  const files = fs.readdirSync(dir).filter((f) => /-\d\d\.png$/.test(f)).sort();
  const outDir = path.join(DST, g.to);
  fs.mkdirSync(outDir, { recursive: true });

  const items = [];
  for (const f of files) {
    const png = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
    if (png.width < g.minSide || png.height < g.minSide) continue;
    const name = `${g.key}-${String(items.length).padStart(2, "0")}.png`;
    fs.copyFileSync(path.join(dir, f), path.join(outDir, name));
    items.push({ src: `${DST}/${g.to}/${name}`, w: png.width, h: png.height });
  }

  catalogue[g.key] = g.single ? items[0] : items;
  console.log(`${g.key.padEnd(8)} ${g.single ? 1 : items.length} item(s)`);
}

fs.writeFileSync(`${DST}/decor.json`, JSON.stringify(catalogue, null, 2));

const total = Object.values(catalogue)
  .reduce((n, v) => n + (Array.isArray(v) ? v.length : 1), 0);
const bytes = fs.readdirSync(DST, { recursive: true })
  .filter((f) => f.endsWith(".png"))
  .reduce((n, f) => n + fs.statSync(path.join(DST, f)).size, 0);
console.log(`\n${total} decor items, ${(bytes / 1024).toFixed(0)} KB total`);
