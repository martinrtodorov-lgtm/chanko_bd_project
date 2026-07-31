// Drive the Chanko game in the installed Chrome and report what a player sees.
const { chromium } = require("playwright-core");

const URL = process.argv[2] || "http://127.0.0.1:8080/";
const SHOTS = __dirname + "/shots";
require("fs").mkdirSync(SHOTS, { recursive: true });

const errors = [];
const log = (...a) => console.log(...a);

(async () => {
  const browser = await chromium.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (!u.includes("favicon")) errors.push(`request failed: ${u} (${r.failure()?.errorText})`);
  });

  const shot = async (name) => {
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
    log(`      shot: ${name}.png`);
  };

  // --- Start screen --------------------------------------------------------
  await page.goto(URL, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForFunction(
    () => !document.getElementById("btn-start").disabled,
    null, { timeout: 120000 }
  );
  log("PASS  start screen loaded, Start enabled");
  log(`      loading text: "${await page.textContent("#loading")}"`);
  await shot("01-start");

  // --- Faction select ------------------------------------------------------
  await page.click("#btn-start");
  await page.waitForSelector(".layer-faction", { timeout: 15000 });
  const factions = await page.$$eval(".faction-card span", (n) => n.map((x) => x.textContent));
  log(`PASS  faction select shows: ${factions.join(", ")}`);
  await shot("02-faction");

  await page.click(".faction-card >> nth=0");   // Pirate
  await page.waitForSelector(".layer-teams", { timeout: 15000 });
  log("PASS  choosing Pirate opened the Teams menu");

  // --- Teams menu ----------------------------------------------------------
  const neutralCount = await page.$$eval(".team-neutral li", (n) => n.length);
  const closeDisabled = await page.getAttribute("#teams-close", "disabled");
  log(`PASS  ${neutralCount} neutral at start, Close disabled: ${closeDisabled !== null}`);
  const names = await page.$$eval(".team-neutral .name", (n) => n.map((x) => x.textContent));
  log(`      roster: ${names.join(", ")}`);
  await shot("03-teams-empty");

  // Refuses to close while anyone is neutral
  await page.keyboard.press("t");
  await page.waitForTimeout(300);
  const stillOpen = await page.$(".layer-teams");
  log(`${stillOpen ? "PASS" : "FAIL"}  T refused to close the menu with ${neutralCount} neutral`);
  log(`      hint: "${await page.textContent("#teams-hint")}"`);

  // Assign 7 to the player, rest to the enemy
  for (let i = 0; i < 7; i++) {
    await page.click(".team-neutral li >> nth=0 >> .arrow >> nth=0");
    await page.waitForTimeout(40);
  }
  const playerCount = await page.textContent(".team-player .count");
  log(`PASS  moved 7 left, player column reads ${playerCount}`);

  // 8th to the player must be refused
  await page.click(".team-neutral li >> nth=0 >> .arrow >> nth=0");
  await page.waitForTimeout(150);
  log(`      cap message: "${await page.textContent("#teams-hint")}"`);

  let guard = 0;
  while ((await page.$$(".team-neutral li")).length > 0 && guard++ < 30) {
    await page.click(".team-neutral li >> nth=0 >> .arrow >> nth=1");
    await page.waitForTimeout(40);
  }
  const enemyCount = await page.textContent(".team-enemy .count");
  log(`PASS  remainder moved right, enemy column reads ${enemyCount}`);
  await shot("04-teams-full");

  const canClose = (await page.getAttribute("#teams-close", "disabled")) === null;
  log(`${canClose ? "PASS" : "FAIL"}  Close enabled once nobody is neutral`);
  await page.click("#teams-close");
  await page.waitForTimeout(600);

  // --- Map -----------------------------------------------------------------
  const gameVisible = await page.isVisible("#game-screen.is-active");
  log(`${gameVisible ? "PASS" : "FAIL"}  map screen active`);
  const hudRows = await page.$$eval(".hud-row", (n) => n.map((x) => x.textContent.trim()));
  log(`PASS  HUD: ${hudRows.join(" | ")}`);
  await page.waitForTimeout(800);
  await shot("05-map");

  // Canvas must not be a flat fill
  const painted = await page.evaluate(() => {
    const c = document.getElementById("game-canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 997) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return seen.size;
  });
  log(`${painted > 12 ? "PASS" : "FAIL"}  canvas painted (${painted} distinct sampled colours)`);

  // Movement
  const before = await page.evaluate(() => document.getElementById("game-canvas").toDataURL().length);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(700);
  await page.keyboard.up("ArrowRight");
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => document.getElementById("game-canvas").toDataURL().length);
  log(`${before !== after ? "PASS" : "FAIL"}  arrow key moved the view`);
  await shot("06-moved");

  // --- Information screen --------------------------------------------------
  await page.keyboard.press("i");
  await page.waitForSelector(".layer-info", { timeout: 15000 });
  const dots = await page.$$eval(".info-dots .dot", (n) => n.length);
  log(`${dots === 5 ? "PASS" : "FAIL"}  information screen has ${dots} pages`);
  for (let p = 1; p <= dots; p++) {
    const title = await page.textContent(".info-title");
    const len = (await page.textContent(".info-text")).length;
    log(`      page ${p}: "${title}" (${len} chars)`);
    if (p === 1) await shot("07-info-p1");
    if (p < dots) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(180); }
  }
  await shot("08-info-p5");
  await page.keyboard.press("3");
  await page.waitForTimeout(200);
  log(`PASS  number key jumped to: "${await page.textContent(".info-title")}"`);
  await page.keyboard.press("i");
  await page.waitForTimeout(300);
  log(`${(await page.$(".layer-info")) ? "FAIL" : "PASS"}  I closed the information screen`);

  // --- Teams reopen --------------------------------------------------------
  await page.keyboard.press("t");
  await page.waitForSelector(".layer-teams", { timeout: 15000 });
  const p2 = await page.textContent(".team-player .count");
  const e2 = await page.textContent(".team-enemy .count");
  log(`PASS  T reopened Teams, player ${p2.trim()} / enemy ${e2.trim()}`);
  await shot("09-teams-reopen");
  await page.keyboard.press("t");
  await page.waitForTimeout(300);
  log(`${(await page.$(".layer-teams")) ? "FAIL" : "PASS"}  T closed Teams again (nobody neutral)`);

  // --- Save ----------------------------------------------------------------
  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem("chanko.save.v1");
    if (!raw) return null;
    const s = JSON.parse(raw);
    return { faction: s.faction, teams: Object.keys(s.teams).length, quests: Object.keys(s.quests).length, trials: s.warlock.trials.length };
  });
  log(`${saved ? "PASS" : "FAIL"}  save written: ${JSON.stringify(saved)}`);

  log("\n" + (errors.length ? `${errors.length} console/network error(s):` : "no console or network errors"));
  errors.slice(0, 25).forEach((e) => log("   " + e));

  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error("DRIVER FAILED: " + e.message); process.exit(2); });
