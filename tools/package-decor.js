// Copy extracted atlas items into assets/decor/ and write the catalogue the
// game loads. Run after tools/atlas.js.
import fs from "fs";
import path from "path";

const SRC = "tools/preview/atlas";
const DST = "assets/decor";

// One catalogue key may draw on several atlases.
const GROUPS = [
  { key: "house", to: "house", from: ["interiorhouse", "houseinterioradditions"], minSide: 14, minFill: 0.3 },
  { key: "tavern", to: "tavern", from: ["interiortavern"], minSide: 14, minFill: 0.25 },
  { key: "tree", to: "tree", from: ["trees"], minSide: 20, minFill: 0.3 },
  { key: "flag", to: "pool", from: ["flag"], minSide: 10, minFill: 0.15 },
  { key: "ship", to: "pool", from: ["ship"], minSide: 40, minFill: 0.1, single: true },
  { key: "anchor", to: "pool", from: ["anchor"], minSide: 8, minFill: 0.1, single: true },
  { key: "barrels", to: "pool", from: ["barrels"], minSide: 8, minFill: 0.1, single: true },
];

const catalogue = {};
let dropped = 0;

for (const g of GROUPS) {
  const outDir = path.join(DST, g.to);
  fs.mkdirSync(outDir, { recursive: true });
  const items = [];

  for (const atlas of g.from) {
    const dir = path.join(SRC, atlas);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, `${atlas.toLowerCase()}-manifest.json`), "utf8")
    );
    for (const m of manifest) {
      if (m.w < g.minSide || m.h < g.minSide) { dropped++; continue; }
      if (m.fill !== undefined && m.fill < g.minFill) { dropped++; continue; }
      const name = `${g.key}-${String(items.length).padStart(2, "0")}.png`;
      fs.copyFileSync(path.join(dir, m.name), path.join(outDir, name));
      items.push({ src: `${DST}/${g.to}/${name}`, w: m.w, h: m.h });
    }
  }

  catalogue[g.key] = g.single ? items[0] : items;
  console.log(`${g.key.padEnd(8)} ${g.single ? 1 : items.length} item(s)  from ${g.from.join(", ")}`);
}

// Named sub-groups picked out of the tavern set by catalogue index, for the
// outdoor seating in front of the tavern and the houses. Indices come from
// the numbered contact sheet; they are stable because packaging is
// deterministic. Re-check them if the tavern atlas is ever re-cut.
const TABLE_SETS = [0, 1, 4, 5, 40, 41, 42, 43];  // table with chairs attached
const STOOLS = [11, 13, 16, 17];                  // loose seating

catalogue.tableset = TABLE_SETS.map((i) => catalogue.tavern[i]).filter(Boolean);
catalogue.chair = STOOLS.map((i) => catalogue.tavern[i]).filter(Boolean);
console.log(`tableset ${catalogue.tableset.length} item(s)  (from tavern indices ${TABLE_SETS.join(",")})`);
console.log(`chair    ${catalogue.chair.length} item(s)  (from tavern indices ${STOOLS.join(",")})`);

fs.writeFileSync(`${DST}/decor.json`, JSON.stringify(catalogue, null, 2));

const total = Object.values(catalogue)
  .reduce((n, v) => n + (Array.isArray(v) ? v.length : 1), 0);
let bytes = 0;
for (const d of fs.readdirSync(DST, { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  for (const f of fs.readdirSync(path.join(DST, d.name))) {
    bytes += fs.statSync(path.join(DST, d.name, f)).size;
  }
}
console.log(`\n${total} decor items, ${(bytes / 1024).toFixed(0)} KB, ${dropped} fragments dropped`);
