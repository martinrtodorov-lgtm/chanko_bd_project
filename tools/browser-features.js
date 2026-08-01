// Drives the coin-bag pickup, the Warlock's greeting-before-accept rule, and
// the quest markers. Usage: node tools/browser-features.js [baseUrl]
const { chromium } = require("playwright-core");
const fs = require("fs");

const BASE = process.argv[2] || "http://127.0.0.1:8080/";
const SHOTS = __dirname + "/preview/features";
fs.mkdirSync(SHOTS, { recursive: true });

const errors = [];
let pass = 0, fail = 0;
const log = (...a) => console.log(...a);
const check = (cond, msg) => { if (cond) { pass++; log(`PASS  ${msg}`); } else { fail++; log(`FAIL  ${msg}`); } };

(async () => {
  const browser = await chromium.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const watch = (p) => {
    p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });
  };

  // --- Produce one save by playing through setup ---------------------------
  let page = await ctx.newPage(); watch(page);
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForFunction(() => !document.getElementById("btn-start").disabled, null, { timeout: 120000 });
  await page.click("#btn-start");
  await page.waitForSelector(".layer-faction");
  await page.click(".faction-card >> nth=0");
  await page.waitForSelector(".layer-teams");
  for (let i = 0; i < 7; i++) { await page.click(".team-neutral li >> nth=0 >> .arrow >> nth=0"); await page.waitForTimeout(25); }
  let g = 0;
  while ((await page.$$(".team-neutral li")).length && g++ < 30) {
    await page.click(".team-neutral li >> nth=0 >> .arrow >> nth=1"); await page.waitForTimeout(25);
  }
  await page.click("#teams-close");
  await page.waitForTimeout(500);
  const baseSave = await page.evaluate(() => localStorage.getItem("chanko.save.v1"));
  await page.close();

  // Park Chanko beside a target tile and resume. Injection happens on the
  // start screen, where the loop is not running and cannot overwrite it.
  const resumeBeside = async (mutate) => {
    const p = await ctx.newPage(); watch(p);
    await p.goto(BASE, { waitUntil: "networkidle", timeout: 120000 });
    const info = await p.evaluate(([json, fnBody]) => {
      const s = JSON.parse(json);
      const target = new Function("s", fnBody)(s);
      s.player.x = (target.x + 0.5) * 32;
      s.player.y = (target.y + 0.5) * 32 + 40;
      localStorage.setItem("chanko.save.v1", JSON.stringify(s));
      return target;
    }, [baseSave, mutate]);
    await p.reload({ waitUntil: "networkidle" });
    await p.waitForFunction(() => !document.getElementById("btn-continue").disabled, null, { timeout: 60000 });
    await p.click("#btn-continue");
    await p.waitForTimeout(800);
    return { page: p, info };
  };

  const opts = (p) => p.$$eval(".npc-options .option", (n) => n.map((x) => x.textContent.trim()));
  const pick = async (p, text) => {
    await p.click(`.npc-options .option:has-text("${text}")`);
    await p.waitForTimeout(220);
  };

  // --- 1. Coin bag ---------------------------------------------------------
  log("\ncoin bag");
  {
    const { page: p, info } = await resumeBeside("return s.coinBag;");
    log(`      bag at tile ${info.x},${info.y}`);
    await p.screenshot({ path: `${SHOTS}/coin-before.png` });

    const drawn = await p.evaluate(() => {
      const c = document.getElementById("game-canvas");
      const d = c.getContext("2d").getImageData(c.width / 2 - 40, c.height / 2 - 80, 80, 60).data;
      let teal = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < 120 && d[i + 1] > 120 && d[i + 2] > 110) teal++;
      }
      return teal;
    });
    check(drawn > 20, `bag sprite is on screen (${drawn} matching pixels)`);

    await p.keyboard.press("e");
    await p.waitForSelector(".layer-dialogue", { timeout: 10000 });
    const title = await p.textContent(".npc-id h2");
    const body = await p.textContent(".npc-text");
    check(body.trim() === "You have found 10 gold!", `popup reads "${body.trim()}"`);
    log(`      popup title: "${title}"`);
    await p.screenshot({ path: `${SHOTS}/coin-popup.png` });
    await pick(p, "Continue");

    const taken = await p.evaluate(() => JSON.parse(localStorage.getItem("chanko.save.v1")).coinBag.taken);
    check(taken === true, "bag marked taken in the save");

    await p.keyboard.press("e");
    await p.waitForTimeout(400);
    check(!(await p.$(".layer-dialogue")), "bag cannot be picked up twice");
    await p.screenshot({ path: `${SHOTS}/coin-after.png` });
    await p.close();
  }

  // --- 2. Warlock shows the greeting until a trial is accepted -------------
  log("\nwarlock greeting rule");
  {
    const { page: p } = await resumeBeside("return { x: 108, y: 62 };");
    const GREETING = "You dare challenge me? You better bring your A-game, buster.";

    await p.keyboard.press("e");
    await p.waitForSelector(".layer-dialogue", { timeout: 10000 });
    let text = (await p.textContent(".npc-text")).trim();
    check(text === GREETING, "before accepting trial 1, shows the greeting");

    await pick(p, "I accept the first trial");
    text = (await p.textContent(".npc-text")).trim();
    check(text.startsWith("Historically, it has been argued"), "on accepting, shows trial 1 information");
    check(!text.includes("galon of beer"), "trial 1 text reflects the updated stash");
    await pick(p, "It will be done");

    text = (await p.textContent(".npc-text")).trim();
    check(text.startsWith("Historically"), "while accepted, keeps showing the trial information");

    await pick(p, "I have completed your quest");
    await p.waitForSelector(".dialog-code", { timeout: 10000 });
    await p.fill(".dialog-code input", "357623");
    await p.click('[data-act="submit"]');
    await p.waitForTimeout(350);
    await pick(p, "Continue");

    text = (await p.textContent(".npc-text")).trim();
    check(text === GREETING, "with trial 2 unlocked but unaccepted, shows the greeting again");
    const o = await opts(p);
    check(o.some((x) => x.includes("Test of Adaptability")), `trial 2 named in options: ${JSON.stringify(o)}`);
    await p.screenshot({ path: `${SHOTS}/warlock-greeting.png` });
    await pick(p, "Leave");
    await p.close();
  }

  // --- 3. Quest markers ----------------------------------------------------
  log("\nquest markers");
  {
    const { page: p, info } = await resumeBeside("return s.npcs.cook;");
    log(`      standing beside the cook at ${info.x},${info.y}`);

    // Probe only the band the marker occupies. Chanko is parked 40px below the
    // NPC's tile centre and the camera centres on him, which puts the NPC's
    // feet at y=328 on the 1280x704 canvas: sprite top 264, nameplate 242-259,
    // "E" prompt at 216-234, marker glyph roughly 199-224. Probing 190-214
    // keeps the gold nameplate border and the gold "E" out of the sample.
    const goldAbove = () => p.evaluate(() => {
      const c = document.getElementById("game-canvas");
      const d = c.getContext("2d").getImageData(600, 190, 80, 24).data;
      let gold = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 220 && d[i + 1] > 180 && d[i + 1] < 235 && d[i + 2] < 110) gold++;
      }
      return gold;
    });

    const notTaken = await goldAbove();
    check(notTaken > 20, `"!" marker drawn before the quest is taken (${notTaken} gold pixels)`);
    await p.screenshot({ path: `${SHOTS}/marker-exclamation.png` });

    await p.keyboard.press("e");
    await p.waitForSelector(".layer-dialogue", { timeout: 10000 });
    await pick(p, "Bribe");
    await pick(p, "I will do it");
    await pick(p, "Leave");
    await p.waitForTimeout(500);
    const taken = await goldAbove();
    check(taken > 40, `"?" marker drawn once the quest is taken (${taken} gold pixels)`);
    await p.screenshot({ path: `${SHOTS}/marker-question.png` });

    await p.keyboard.press("e");
    await p.waitForSelector(".layer-dialogue", { timeout: 10000 });
    await pick(p, "I have completed your quest");
    await p.waitForSelector(".dialog-code", { timeout: 10000 });
    await p.fill(".dialog-code input", "534234");
    await p.click('[data-act="submit"]');
    await p.waitForTimeout(350);
    await pick(p, "Continue");
    await pick(p, "Leave");
    await p.waitForTimeout(500);
    const done = await goldAbove();
    check(done < 15, `no marker once the quest is completed (${done} gold pixels)`);
    await p.screenshot({ path: `${SHOTS}/marker-none.png` });
    await p.close();
  }

  log(`\n${pass} passed, ${fail} failed`);
  log(errors.length ? `${errors.length} console error(s):` : "no console errors");
  errors.slice(0, 15).forEach((e) => log("   " + e));
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error("DRIVER FAILED: " + e.message); process.exit(2); });
