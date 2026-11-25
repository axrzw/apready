/** E2E «اشرح بالكاميرا» with 3 browsers. Same env as e2e.cjs. */
const { chromium, devices } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SECRET = process.env.E2E_SECRET;
const PW = process.env.GROUP_PASSWORD || "dev";
let failures = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || failures++);

async function open(browser, name, opts) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.who = name;
  p.on("pageerror", (e) => console.log(`[${name}]`, e.message));
  await p.goto(`${BASE}/login`);
  await p.fill("input[name=password]", PW);
  await p.fill("input[name=name]", name);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click("button:has-text('ادخل')")]);
  return p;
}
const view = (p, code) => p.evaluate(async (c) => (await fetch(`/api/rooms/${c}`)).json(), code);
const secretOf = async (code) => (await fetch(`${BASE}/api/test/answer?secret=${SECRET}&code=${code}`)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPhase(p, code, phases, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await view(p, code);
    if (process.env.DEBUG) console.log("phase", v.phase, v.error ?? "");
    if (phases.includes(v.phase)) return v;
    await sleep(400);
  }
  const last = await view(p, code);
  throw new Error(`phase ${phases} not reached (now ${last.phase}, error ${last.error ?? "-"}, players ${last.players?.length})`);
}

/** The explainer of this turn: picks the first offered item; returns their page. */
async function explainer(pages, code) {
  await waitPhase(pages[0], code, ["describe_choose"]);
  for (let i = 0; i < 40; i++) {
    for (const p of pages) {
      const pv = await view(p, code);
      if (pv.phase === "describe_choose" && pv.party?.offered?.length) {
        await p.locator("button.group").first().click();
        await waitPhase(p, code, ["camera_setup"]);
        return p;
      }
    }
    await sleep(300);
  }
  throw new Error("no explainer");
}

(async () => {
  const browser = await chromium.launch();
  const A = await open(browser, "Cam-Ali", { viewport: { width: 1280, height: 900 } });
  const B = await open(browser, "Cam-Badr", devices["iPhone 13"]);
  const C = await open(browser, "Cam-Chad", devices["Pixel 7"]);
  const code = await A.evaluate(async () => (await (await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: { kind: "camera", count: 2, camera: { setupSec: 10, style: "talk" }, describe: { turnSec: 25 } } }) })).json()).code);
  for (const p of [A, B, C]) {
    await p.goto(`${BASE}/room/${code}`);
    await p.click("button:has-text('جاهز')");
    p.uid = (await view(p, code)).me;
  }
  await A.waitForTimeout(800);
  await A.click("form button.btn-primary:has-text('ابدأ')");
  const pages = [A, B, C];

  // turn 1: camera ready -> starts at once; guesses + points
  let E = await explainer(pages, code);
  await E.click("button:has-text('الكاميرا جاهزة')");
  let v = await waitPhase(A, code, ["describe_turn"], 5000);
  ok(v.phase === "describe_turn", "«الكاميرا جاهزة» starts the turn at once");
  const others = pages.filter((p) => p !== E);
  await others[0].locator("text=شغّلوا بث").first().waitFor({ timeout: 5000 });
  ok(true, "the others see «شغّلوا بث ... في الديسكورد»");
  const sec = await secretOf(code);
  for (const g of others) {
    await g.fill("input[placeholder='تخمينك']", sec.names[0]);
    await g.click("button:has-text('خمّن')");
  }
  v = await waitPhase(A, code, ["describe_reveal", "describe_choose"], 10000);
  const scores = Object.fromEntries(v.players.map((p) => [p.id, p.score]));
  ok(others.every((g) => scores[g.uid] > 0) && scores[E.uid] > 0, `guessers and explainer scored ${JSON.stringify(Object.values(scores))}`);

  // turn 2: no camera -> back -> no camera -> talk
  E = await explainer(pages, code);
  await E.click("button:has-text('ما عندي كاميرا')");
  await E.locator("[role=dialog]").waitFor({ timeout: 5000 });
  await E.click("button:has-text('رجوع')");
  v = await waitPhase(E, code, ["camera_setup"], 5000);
  ok(v.phase === "camera_setup", "«رجوع» returns to the setup");
  await E.click("button:has-text('ما عندي كاميرا')");
  await E.click("button:has-text('أشرح بالكلام')");
  v = await waitPhase(E, code, ["describe_turn"], 5000);
  ok(v.party.turnMode === "talk", "«ما عندي كاميرا» → «أشرح بالكلام» plays like the describer");
  const sec2 = await secretOf(code);
  for (const g of pages.filter((p) => p !== E)) {
    await g.fill("input[placeholder='تخمينك']", sec2.names[0]);
    await g.click("button:has-text('خمّن')");
  }

  // turn 3: no camera -> skip my turn (no points, no penalty)
  E = await explainer(pages, code);
  const before = (await view(A, code)).players.find((p) => p.id === E.uid).score;
  await E.click("button:has-text('ما عندي كاميرا')");
  await E.click("button:has-text('تخطَّ دوري')");
  v = await waitPhase(A, code, ["describe_choose"], 5000);
  ok(v.party.describerId !== E.uid && v.players.find((p) => p.id === E.uid).score === before, "«تخطَّ دوري» passes the turn without points or penalty");

  // turn 4: nobody presses anything -> confirm after the setup, then skipped 10 s later
  E = await explainer(pages, code);
  v = await waitPhase(A, code, ["camera_confirm"], 15000);
  ok(v.phase === "camera_confirm", "setup time out shows the «ما عندي كاميرا» confirm");
  v = await waitPhase(A, code, ["describe_choose", "ending", "finished"], 15000);
  ok(v.party?.describerId !== E.uid || v.phase !== "describe_choose", "no choice within 10 s skips the turn");

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => (console.error("E2E crashed:", e.message), process.exit(1)));
