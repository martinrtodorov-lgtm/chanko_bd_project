// Drives hearts, the ghost, and the death / Wisdom-save flow.
// Usage: node tools/browser-combat.js [baseUrl]
const { chromium } = require("playwright-core");
const fs = require("fs");

const BASE = process.argv[2] || "http://127.0.0.1:8080/";
const SHOTS = __dirname + "/preview/combat";
fs.mkdirSync(SHOTS, { recursive: true });

const errors = [];
let pass = 0, fail = 0;
const log = (...a) => console.log(...a);
const check = (c, m) => { if (c) { pass++; log(`PASS  ${m}`); } else { fail++; log(`FAIL  ${m}`); } };

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

  // One completed setup, reused as the base save for every scenario.
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

  const heartsShown = await page.$$eval("#lives .heart", (n) => n.length);
  const lost = await page.$$eval("#lives .heart.is-lost", (n) => n.length);
  check(heartsShown === 3 && lost === 0, `HUD shows ${heartsShown} hearts, ${lost} greyed at the start`);
  await page.screenshot({ path: `${SHOTS}/01-three-hearts.png` });

  const baseSave = await page.evaluate(() => localStorage.getItem("chanko.save.v1"));
  await page.close();

  // Resume from an edited save. Injection happens on the start screen, where
  // the loop is not running and cannot overwrite it.
  const resume = async (fnBody) => {
    const p = await ctx.newPage(); watch(p);
    await p.goto(BASE, { waitUntil: "networkidle", timeout: 120000 });
    await p.evaluate(([json, body]) => {
      const s = JSON.parse(json);
      new Function("s", body)(s);
      localStorage.setItem("chanko.save.v1", JSON.stringify(s));
    }, [baseSave, fnBody]);
    await p.reload({ waitUntil: "networkidle" });
    await p.waitForFunction(() => !document.getElementById("btn-continue").disabled, null, { timeout: 60000 });
    await p.click("#btn-continue");
    await p.waitForTimeout(700);
    return p;
  };
  const liveState = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("chanko.save.v1")));

  // --- Heart pickup --------------------------------------------------------
  log("\nheart pickup");
  {
    const p = await resume(`
      s.lives = 1;
      s.player.x = (s.hearts[0].x + 0.5) * 32;
      s.player.y = (s.hearts[0].y + 0.5) * 32 + 40;
      s.ghost.x = s.player.x + 6000; s.ghost.y = s.player.y + 6000;
    `);
    const greyed = await p.$$eval("#lives .heart.is-lost", (n) => n.length);
    check(greyed === 2, `two hearts greyed out on one life (${greyed})`);
    await p.screenshot({ path: `${SHOTS}/02-one-heart.png` });

    await p.keyboard.press("e");
    await p.waitForSelector(".layer-dialogue", { timeout: 10000 });
    const body = await p.textContent(".npc-text");
    check(/strength return/i.test(body), `pickup message: "${body.trim()}"`);
    await p.click('.npc-options .option:has-text("Continue")');
    await p.waitForTimeout(300);

    const s = await liveState(p);
    check(s.lives === 2, `life restored to ${s.lives}`);
    check(s.hearts[0].taken === true, "heart marked taken");
    const greyedAfter = await p.$$eval("#lives .heart.is-lost", (n) => n.length);
    check(greyedAfter === 1, `HUD now shows one greyed heart (${greyedAfter})`);

    await p.keyboard.press("e");
    await p.waitForTimeout(400);
    check(!(await p.$(".layer-dialogue")), "the same heart cannot be taken twice");
    await p.close();
  }

  // --- Ghost chases and costs a life --------------------------------------
  log("\nghost");
  {
    // 600px out: on screen so it gives chase, but far enough that it cannot
    // arrive during the resume settle and skew the starting count.
    const p = await resume(`s.ghost.x = s.player.x + 600; s.ghost.y = s.player.y;`);
    await p.screenshot({ path: `${SHOTS}/03-ghost-near.png` });

    const before = (await liveState(p)).lives;
    let after = before;
    for (let i = 0; i < 25 && after === before; i++) {
      await p.waitForTimeout(200);
      after = (await liveState(p)).lives;
    }
    check(after === before - 1, `ghost caught Chanko: ${before} -> ${after} lives`);

    const s = await liveState(p);
    const away = Math.hypot(s.ghost.x - s.player.x, s.ghost.y - s.player.y);
    check(away >= 1400, `ghost respawned ${Math.round(away)}px away`);
    await p.screenshot({ path: `${SHOTS}/04-after-hit.png` });
    await p.close();
  }

  // --- Slashing banishes it without damage --------------------------------
  log("\nslash");
  {
    const p = await resume(`
      s.player.dir = "right";
      s.ghost.x = s.player.x + 55; s.ghost.y = s.player.y;
    `);
    const before = (await liveState(p)).lives;
    await p.keyboard.press("a");
    await p.waitForTimeout(500);
    const s = await liveState(p);
    check(s.lives === before, `no life lost when the swing lands (${s.lives})`);
    const away = Math.hypot(s.ghost.x - s.player.x, s.ghost.y - s.player.y);
    check(away >= 1400, `slashed ghost respawned ${Math.round(away)}px away`);
    await p.close();
  }

  // --- Death: Wisdom save, success -----------------------------------------
  log("\nwisdom save - success");
  {
    const p = await resume(`s.lives = 1; s.ghost.x = s.player.x + 120; s.ghost.y = s.player.y;`);
    await p.waitForSelector(".layer-dialogue", { timeout: 15000 });
    const title = await p.textContent(".npc-id h2");
    const body = await p.textContent(".npc-text");
    check(/wisdom/i.test(title), `save prompt titled "${title}"`);
    check(/DC 10/.test(body), "prompt states DC 10");
    const options = await p.$$eval(".npc-options .option", (n) => n.map((x) => x.textContent.trim()));
    check(options.length === 2, `two options offered: ${JSON.stringify(options)}`);
    await p.screenshot({ path: `${SHOTS}/05-wisdom-save.png` });

    await p.click('.npc-options .option:has-text("Success")');
    await p.waitForTimeout(600);
    const s = await liveState(p);
    check(s.lives === 1, `success restored a heart (${s.lives})`);
    check(await p.isVisible("#game-screen.is-active"), "play continues on the map");
    await p.close();
  }

  // --- Death: Wisdom save, failure -----------------------------------------
  log("\nwisdom save - failure");
  {
    const p = await resume(`
      s.lives = 1;
      s.quests.cook.state = "completed";
      s.ghost.x = s.player.x + 120; s.ghost.y = s.player.y;
    `);
    await p.waitForSelector(".layer-dialogue", { timeout: 15000 });
    await p.click('.npc-options .option:has-text("Failure")');
    await p.waitForSelector(".layer-curse", { timeout: 10000 });
    const curse = await p.textContent(".ending-text");
    check(curse.trim() === "You have been unable to break a lifelong curse.",
      `curse screen reads "${curse.trim()}"`);
    await p.waitForTimeout(1800);
    await p.screenshot({ path: `${SHOTS}/06-curse.png` });

    await p.click("#curse-return");
    await p.waitForTimeout(700);
    check(await p.isVisible("#start-screen.is-active"), "returned to the start screen");
    check(!(await p.isVisible("#lives.is-visible")), "hearts HUD hidden on the menu");
    const cont = await p.getAttribute("#btn-continue", "disabled");
    check(cont === null, "Continue is available again");

    const s = await liveState(p);
    check(s.lives === 3, `hearts reset to ${s.lives} for the next run`);
    check(s.quests.cook.state === "completed", "quest progress survived the game over");
    await p.screenshot({ path: `${SHOTS}/07-back-to-start.png` });
    await p.close();
  }

  log(`\n${pass} passed, ${fail} failed`);
  log(errors.length ? `${errors.length} console error(s):` : "no console errors");
  errors.slice(0, 15).forEach((e) => log("   " + e));
  await browser.close();
  process.exit(fail || errors.length ? 1 : 0);
})().catch((e) => { console.error("DRIVER FAILED: " + e.message); process.exit(2); });
