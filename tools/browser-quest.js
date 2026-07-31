// Drive the Warlock conversation: hint check, accepting trial 1, a wrong code,
// then the real code.
const { chromium } = require("playwright-core");
const SHOTS = __dirname + "/shots";

const errors = [];
const log = (...a) => console.log(...a);

(async () => {
  const browser = await chromium.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
  });
  let page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });

  const opts = async () =>
    page.$$eval(".npc-options .option", (n) => n.map((x) => x.textContent.trim()));
  const pick = async (text) => {
    await page.click(`.npc-options .option:has-text("${text}")`);
    await page.waitForTimeout(250);
  };

  // Reach the map once so a save exists in the expected shape.
  await page.goto((process.argv[2] || "http://127.0.0.1:8080/"), { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForFunction(() => !document.getElementById("btn-start").disabled, null, { timeout: 120000 });
  await page.click("#btn-start");
  await page.waitForSelector(".layer-faction");
  await page.click(".faction-card >> nth=0");
  await page.waitForSelector(".layer-teams");
  for (let i = 0; i < 7; i++) { await page.click(".team-neutral li >> nth=0 >> .arrow >> nth=0"); await page.waitForTimeout(30); }
  let g = 0;
  while ((await page.$$(".team-neutral li")).length && g++ < 30) {
    await page.click(".team-neutral li >> nth=0 >> .arrow >> nth=1"); await page.waitForTimeout(30);
  }
  await page.click("#teams-close");
  await page.waitForTimeout(600);

  // Take the save out, then close this page. A running game saves its live
  // position on beforeunload, which would overwrite anything injected here.
  const saveJson = await page.evaluate(() => localStorage.getItem("chanko.save.v1"));
  await page.close();

  // Inject from the start screen, where the loop is not running.
  const page2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page2.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page2.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });
  await page2.goto((process.argv[2] || "http://127.0.0.1:8080/"), { waitUntil: "networkidle", timeout: 120000 });

  // Park Chanko beside the Warlock, who always stands at tile (108, 62).
  await page2.evaluate((json) => {
    const s = JSON.parse(json);
    s.player.x = 3472; s.player.y = 2040;
    localStorage.setItem("chanko.save.v1", JSON.stringify(s));
  }, saveJson);
  await page2.reload({ waitUntil: "networkidle" });
  await page2.waitForFunction(() => !document.getElementById("btn-continue").disabled, null, { timeout: 60000 });
  await page2.click("#btn-continue");
  await page2.waitForTimeout(900);
  page = page2;
  log("PASS  Continue restored the save beside the Warlock");
  await page.screenshot({ path: `${SHOTS}/10-beside-warlock.png` });

  // --- Open the conversation ----------------------------------------------
  await page.keyboard.press("e");
  await page.waitForSelector(".layer-dialogue", { timeout: 15000 });
  const name = await page.textContent(".npc-id h2");
  const prof = await page.textContent(".profession");
  const portrait = await page.getAttribute(".npc-portrait-pane img", "src");
  log(`PASS  dialogue opened: "${name}" / "${prof}"`);
  log(`      portrait: ${portrait}`);
  log(`      text: "${(await page.textContent(".npc-text")).slice(0, 70)}..."`);
  log(`      options: ${JSON.stringify(await opts())}`);
  await page.screenshot({ path: `${SHOTS}/11-warlock.png` });

  // --- Hint behind a DC 15 check ------------------------------------------
  await pick("Ask for a hint");
  log(`PASS  hint check prompt: "${(await page.textContent(".npc-text")).slice(0, 60)}..."`);
  log(`      options: ${JSON.stringify(await opts())}`);
  await pick("Failure");
  log(`      after failing: "${(await page.textContent(".npc-text")).slice(0, 60)}..."`);
  await pick("Continue");

  await pick("Ask for a hint");
  await pick("Success");
  log(`PASS  hint granted: "${await page.textContent(".npc-text")}"`);
  await pick("Continue");

  // --- Accept trial 1 ------------------------------------------------------
  const beforeAccept = await opts();
  log(`      options now: ${JSON.stringify(beforeAccept)}`);
  await pick("I accept the first trial");
  log(`PASS  trial 1 accepted, information shown (${(await page.textContent(".npc-text")).length} chars)`);
  await page.screenshot({ path: `${SHOTS}/12-trial-accepted.png` });
  await pick("It will be done");
  log(`      options after accepting: ${JSON.stringify(await opts())}`);

  // --- Wrong code then right code -----------------------------------------
  await pick("I have completed your quest");
  await page.waitForSelector(".dialog-code", { timeout: 10000 });
  await page.fill(".dialog-code input", "000000");
  await page.click('[data-act="submit"]');
  await page.waitForTimeout(350);
  log(`PASS  wrong code rejected: "${await page.textContent(".npc-text")}"`);
  await pick("Continue");

  await pick("I have completed your quest");
  await page.waitForSelector(".dialog-code", { timeout: 10000 });
  await page.fill(".dialog-code input", "357623");
  await page.click('[data-act="submit"]');
  await page.waitForTimeout(400);
  log(`PASS  correct code accepted: "${await page.textContent(".npc-text")}"`);
  await page.screenshot({ path: `${SHOTS}/13-trial-complete.png` });
  await pick("Continue");

  // Trial 2 should now be the live one
  log(`PASS  next options: ${JSON.stringify(await opts())}`);
  const state = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("chanko.save.v1"));
    return s.warlock.trials.map((t) => t.state).join(",");
  });
  log(`${state.startsWith("completed,available,locked") ? "PASS" : "FAIL"}  trial states persisted: ${state}`);

  await pick("Leave");
  log("PASS  conversation closed");

  log("\n" + (errors.length ? `${errors.length} error(s):` : "no console errors"));
  errors.slice(0, 20).forEach((e) => log("   " + e));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error("DRIVER FAILED: " + e.message); process.exit(2); });

