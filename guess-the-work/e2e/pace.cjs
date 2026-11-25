/** E2E: length / time presets, «زد», «خلاص», new round, extend vote, leaving mid-game. Same env as e2e.cjs. */
const { chromium, devices } = require("playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const PW = process.env.GROUP_PASSWORD || "dev";
let failures = 0;
const ok = (c, m) => (console.log(`${c ? "PASS" : "FAIL"}  ${m}`), c || failures++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browser, name, opts) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log(`[${name}]`, e.message));
  await p.goto(`${BASE}/login`);
  await p.fill("input[name=password]", PW);
  await p.fill("input[name=name]", name);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click("button:has-text('ادخل')")]);
  return p;
}
const view = (p, code) => p.evaluate(async (c) => (await fetch(`/api/rooms/${c}`)).json(), code);
const act = (p, code, a) => p.evaluate(async ({ c, a }) => (await fetch(`/api/rooms/${c}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(a) })).json(), { c: code, a });
async function waitPhase(p, code, phases, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await view(p, code);
    if (phases.includes(v.phase)) return v;
    await sleep(300);
  }
  throw new Error(`phase ${phases} not reached (now ${(await view(p, code)).phase})`);
}
async function enter(p, code) {
  await p.goto(`${BASE}/room/${code}`);
  // the «جاهز» tap (unlocks audio) shows once per browser session
  const btn = p.locator("button:has-text('جاهز')");
  await btn.waitFor({ timeout: 4000 }).catch(() => {});
  if (await btn.count()) await btn.click();
}
const newRoom = (p, settings) => p.evaluate(async (s) => (await (await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: s }) })).json()).code, settings);

(async () => {
  const browser = await chromium.launch();
  const A = await open(browser, "Pace-Ali", { viewport: { width: 1280, height: 900 } });
  const B = await open(browser, "Pace-Badr", devices["iPhone 13"]);
  const C = await open(browser, "Pace-Chad", devices["Pixel 7"]);

  // 1. the setup screen: presets, custom, open, vote, advanced
  const code = await newRoom(A, { kind: "guess", modes: ["poster"] });
  for (const p of [A, B, C]) await enter(p, code);
  // the host's last choice may have «مفتوح» on (from an earlier run): start from a fixed length
  await A.locator("form button:has-text('سريعة')").waitFor();
  await sleep(800);
  const openSwitch = A.locator("button[role=switch]:has-text('مفتوح')");
  if ((await openSwitch.getAttribute("aria-checked")) === "true") await openSwitch.click();
  const voteSwitch = A.locator("button[role=switch]:has-text('تصويت على التمديد')");
  if ((await voteSwitch.getAttribute("aria-checked")) === "true") await voteSwitch.click();
  await A.click("form button:has-text('سريعة')");
  ok((await A.locator("text=5 أسئلة · 15 ثانية لكل سؤال").count()) > 0, "«سريعة» = 5 questions, 15 s");
  await A.click("form button:has-text('طويلة')");
  ok((await A.locator("text=20 سؤال · 45 ثانية لكل سؤال").count()) > 0, "«طويلة» = 20 questions, 45 s");
  ok((await A.locator("text=مصدر الأسئلة").count()) === 0, "advanced settings are folded away");
  await A.click("button:has-text('إعدادات متقدمة')");
  ok((await A.locator("text=مصدر الأسئلة").count()) > 0, "«إعدادات متقدمة» opens them");
  await A.click("form button:has-text('مخصص')");
  await A.locator("input[type=number]").nth(0).fill("1");
  await A.locator("input[type=number]").nth(1).fill("40");
  ok((await A.locator("text=1 سؤال · 40 ثانية لكل سؤال").count()) > 0, "«مخصص»: 1 question, 40 s");
  await A.click("form button.btn-primary:has-text('ابدأ')");
  let v = await waitPhase(A, code, ["question"]);
  ok(v.total === 1 && v.settings.timeLimitSec === 40, "the game starts with the custom length and time");

  // 2. host changes the time mid-question
  await A.click("button:has-text('تحكّم')");
  await A.locator("input[placeholder='40']").fill("90");
  await A.locator("form:has(input[placeholder='40']) button:has-text('غيّر')").click();
  await sleep(800);
  v = await view(A, code);
  ok(v.phaseEndsAt - v.phaseStartedAt === 90_000, "time changed to 90 s for the running question");

  // 3. a player leaves mid-game; the others go on
  await C.click("button:has-text('اطلع من اللعبة')");
  await C.click("button:has-text('إيه، اطلع')");
  await C.waitForURL((u) => !u.pathname.startsWith("/room"), { timeout: 8000 });
  v = await view(A, code);
  ok(v.players.length === 2 && v.phase === "question", "C left; the game goes on with A and B");

  // 4. the last question ends -> the ending screen (not the summary)
  await act(A, code, { type: "skip" });
  await waitPhase(A, code, ["reveal"]);
  await act(A, code, { type: "skip" });
  await waitPhase(A, code, ["ending"]);
  await A.locator("text=نكمّل ولا خلاص؟").waitFor({ timeout: 5000 });
  ok(true, "after the last question the host sees «نكمّل ولا خلاص؟»");
  ok(await B.locator("text=المضيف يقرر").first().waitFor({ timeout: 6000 }).then(() => true, () => false), "players see that the host decides");

  // 5. «زد 5»: five more questions, points carry on
  const before = (await view(A, code)).players.map((p) => p.score).join(",");
  await A.click("button:has-text('زد 5 أسئلة')");
  v = await waitPhase(A, code, ["question"], 20000);
  ok(v.total === 6 && v.index === 1, `«زد 5» added five questions (now ${v.index + 1} / ${v.total})`);
  ok(v.players.map((p) => p.score).join(",") === before, "scores carried over");

  // 6. «خلاص» mid-game -> summary
  await A.click("button:has-text('تحكّم')");
  await A.click("button:has-text('خلاص، للملخص')");
  v = await waitPhase(A, code, ["finished"], 10000);
  ok(v.phase === "finished", "«خلاص» goes to the summary");

  // 7. new round with the same settings
  await A.click("button:has-text('جولة جديدة بنفس الإعدادات')");
  v = await waitPhase(A, code, ["question"], 20000);
  ok(v.total === 1 && v.players.every((p) => p.score === 0), "new round: same settings, fresh scores");

  // 8. the host's choice is remembered for this mode
  const saved = await A.evaluate(async () => (await fetch("/api/pace?kind=guess")).json());
  ok(saved?.count === 1 && saved?.timeLimitSec === 90, `last choice remembered (${JSON.stringify(saved && { count: saved.count, sec: saved.timeLimitSec })})`);

  // 9. vote to extend: the majority decides
  const code2 = await newRoom(A, { kind: "guess", modes: ["poster"], count: 1, timeLimitSec: 20, pace: { open: false, extendVote: true } });
  for (const p of [A, B]) await enter(p, code2);
  await sleep(600);
  await act(A, code2, { type: "start" });
  await waitPhase(A, code2, ["question"]);
  await act(A, code2, { type: "skip" });
  await waitPhase(A, code2, ["reveal"]);
  await act(A, code2, { type: "skip" });
  await waitPhase(B, code2, ["ending"]);
  await B.locator("button:has-text('زد')").first().waitFor({ timeout: 5000 });
  await B.locator("button:has-text('زد')").first().click();
  await A.locator(".h-14:has-text('زد')").click();
  v = await waitPhase(A, code2, ["question"], 20000);
  ok(v.total === 6, "both voted «زد»: five more questions");

  // 10. open mode: more questions come before running out
  const code3 = await newRoom(A, { kind: "guess", modes: ["poster"], count: 2, timeLimitSec: 10, pace: { open: true, extendVote: false } });
  await enter(A, code3);
  await act(A, code3, { type: "start" });
  v = await waitPhase(A, code3, ["question"]);
  ok(v.total >= 10, `open mode starts with a batch and asks for more (${v.total})`);
  ok((await A.locator("text=مفتوح").count()) > 0, "the counter says «مفتوح»");

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
