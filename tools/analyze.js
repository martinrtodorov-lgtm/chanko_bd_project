const fs = require("fs");
const { PNG } = require("pngjs");

const file = process.argv[2];
const png = PNG.sync.read(fs.readFileSync(file));
const { width, height, data } = png;

const at = (x, y) => {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};

// Sample the border ring — background should dominate here.
const border = [];
for (let x = 0; x < width; x += 3) {
  border.push(at(x, 2), at(x, height - 3));
}
for (let y = 0; y < height; y += 3) {
  border.push(at(2, y), at(width - 3, y));
}

const counts = new Map();
for (const [r, g, b] of border) {
  const k = `${r},${g},${b}`;
  counts.set(k, (counts.get(k) || 0) + 1);
}
const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
const [bgKey] = ranked[0];
const bg = bgKey.split(",").map(Number);

// How far does the border actually stray from that dominant colour?
let within2 = 0, within8 = 0, within20 = 0;
for (const [r, g, b] of border) {
  const d = Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
  if (d <= 2) within2++;
  if (d <= 8) within8++;
  if (d <= 20) within20++;
}

// Whole-image: what share of pixels is near the background colour?
let bgPixels = 0;
for (let i = 0; i < data.length; i += 4) {
  const d = Math.max(
    Math.abs(data[i] - bg[0]),
    Math.abs(data[i + 1] - bg[1]),
    Math.abs(data[i + 2] - bg[2])
  );
  if (d <= 20) bgPixels++;
}

const pct = (n, total) => ((n / total) * 100).toFixed(1) + "%";
console.log(`\n${file.split(/[\\/]/).pop()}  ${width}x${height}`);
console.log(`  dominant border colour : rgb(${bg.join(", ")})`);
console.log(`  distinct border colours: ${counts.size}`);
console.log(`  border within +/-2     : ${pct(within2, border.length)}`);
console.log(`  border within +/-8     : ${pct(within8, border.length)}`);
console.log(`  border within +/-20    : ${pct(within20, border.length)}`);
console.log(`  image pixels near bg   : ${pct(bgPixels, width * height)}`);
console.log(`  top 5 border colours   : ${ranked.slice(0, 5).map(([k, c]) => `${k} (${c})`).join("  ")}`);
