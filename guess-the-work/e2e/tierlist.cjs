/** E2E «تير ليست» with 3 browsers: vote, discussion, individual, guess a friend, archive, «عيدها», export. Same env as e2e.cjs. */
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
  const btn = p.locator("button:has-text('جاهز')");
  await btn.waitFor({ timeout: 4000 }).catch(() => {});
  if (await btn.count()) await btn.click();
}
const newRoom = (p, settings) => p.evaluate(async (s) => (await (await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: s }) })).json()).code, settings);
const tierBtn = (p, t) => p.locator(`button.font-display:text-is("${t}")`).first();

(async () => {
  const browser = await chromium.launch();
  const A = await open(browser, "Tier-Ali", { viewport: { width: 1280, height: 900 } });
  const B = await open(browser, "Tier-Badr", devices["iPhone 13"]);
  const C = await open(browser, "Tier-Chad", devices["Pixel 7"]);
  const all = [A, B, C];

  // 1. secret vote, set up from the UI
  const code = await newRoom(A, { kind: "guess" });
  for (const p of all) await enter(p, code);
  await A.click("form button:has-text('تير ليست')");
  await A.locator("text=كيف نقرر").waitFor();
  await A.click("form button:has-text('تصويت سري')");
  await A.click("form button:has-text('أنمي')");
  await A.click("form button:has-text('مخصص')");
  await A.locator("input[type=number]").nth(0).fill("2");
  await A.click("form button.btn-primary:has-text('ابدأ')");
  let v = await waitPhase(A, code, ["tier_item"]);
  ok(v.party?.current && v.party.total === 2, `the vote starts with item 1 of ${v.party?.total}`);
  await tierBtn(A, "S").click();
  await tierBtn(B, "S").click();
  await sleep(500);
  v = await view(C, code);
  ok(v.party.votes === 2 && v.party.myVote === undefined, "votes are secret (C sees only how many voted)");
  await tierBtn(C, "B").click();
  v = await waitPhase(A, code, ["tier_result"], 8000);
  ok(v.party.result?.tier === "S" && v.party.result.disagree === 1, "the majority (S) wins; 1 disagreed");
  await A.locator("text=1 ما وافقوا").waitFor({ timeout: 5000 });
  ok(true, "the result shows how many disagreed");
  const scores = Object.fromEntries(v.players.map((p) => [p.name, p.score]));
  ok(scores["Tier-Ali"] === 100 && scores["Tier-Chad"] === 20, `closeness points (${JSON.stringify(scores)})`);
  await waitPhase(A, code, ["tier_item"], 10000);
  for (const p of all) await tierBtn(p, "A").click();
  v = await waitPhase(A, code, ["ending"], 15000);
  ok(v.phase === "ending", "after the last item: the ending screen");
  await A.click("button:has-text('زد 5 عناصر')");
  v = await waitPhase(A, code, ["tier_item"], 15000);
  ok(v.party.total === 7 && v.party.index === 2, "«زد 5» adds items to the same board");
  await A.click("button:has-text('تحكّم')");
  await A.click("button:has-text('خلاص، للملخص')");
  await waitPhase(A, code, ["finished"], 10000);
  await A.locator("text=لوحتنا").first().waitFor({ timeout: 5000 });
  ok(true, "the final board shows at the end");

  // 2. free discussion: a move shows the mover, majority «موافق» locks, host «ثبّت»
  const code2 = await newRoom(A, { kind: "tierlist", count: 2, tier: { style: "discuss", topic: { type: "anime" }, source: "any", manual: [], points: true, itemSec: 60, boardSec: 150 } });
  for (const p of all) await enter(p, code2);
  await sleep(500);
  await act(A, code2, { type: "start" });
  await waitPhase(A, code2, ["tier_item"]);
  await tierBtn(B, "C").click();
  await A.locator("text=Tier-Badr حطّها في").waitFor({ timeout: 5000 });
  ok(true, "everybody sees who moved it");
  await A.click("button:has-text('موافق')");
  v = await waitPhase(A, code2, ["tier_result"], 5000);
  ok(v.party.result?.tier === "C", "majority «موافق» locks it");
  await waitPhase(A, code2, ["tier_item"], 10000);
  await tierBtn(C, "S").click();
  await sleep(400);
  await A.click("button:has-text('ثبّت')");
  v = await waitPhase(A, code2, ["tier_result"], 5000);
  ok(v.party.result?.tier === "S" && v.party.result.how === "host", "the host «ثبّت» locks it");

  // 3. individual boards: tap item then tier, «ما شفته», private until the reveal
  const code3 = await newRoom(A, { kind: "tierlist", count: 3, tier: { style: "solo", topic: { type: "anime" }, source: "any", manual: [], points: true, itemSec: 30, boardSec: 120 } });
  for (const p of all) await enter(p, code3);
  await sleep(500);
  await act(A, code3, { type: "start" });
  v = await waitPhase(A, code3, ["tier_board"]);
  const ids = v.party.items.map((x) => x.id);
  // A uses the UI: tap the first tile, then the S row
  await A.locator(".border-dashed button").first().click();
  await A.locator("[aria-label='تير S']").click();
  await sleep(500);
  ok(Object.values((await view(A, code3)).party.myBoard).includes("S"), "tap an item, tap a tier: placed");
  await A.locator(".border-dashed button").first().click();
  await A.locator("[aria-label='ما شفته']").click();
  await sleep(300);
  for (const id of ids) await act(A, code3, { type: "tier_place", itemId: id, place: "A" });
  for (const id of ids) await act(B, code3, { type: "tier_place", itemId: id, place: "A" });
  await act(C, code3, { type: "tier_place", itemId: ids[0], place: "F" });
  await act(C, code3, { type: "tier_place", itemId: ids[1], place: "unseen" });
  ok(!(await view(B, code3)).party.boards, "boards stay private while filling");
  for (const p of all) await act(p, code3, { type: "tier_submit" });
  v = await waitPhase(A, code3, ["tier_reveal"], 8000);
  ok(!!v.party.boards && Object.keys(v.party.boards).length === 3, "the reveal shows every board");
  ok(v.party.board[ids[1]] === "A", "«ما شفته» does not count in the average");
  ok(v.party.stats?.outlier?.id === v.players.find((p) => p.name === "Tier-Chad").id, "the outlier is found");
  await A.locator("text=كل اللوحات").waitFor({ timeout: 5000 });
  const dl = A.waitForEvent("download", { timeout: 15000 });
  await A.click("button:has-text('صورة')");
  const file = await dl;
  ok(/\.png$/.test(file.suggestedFilename()), "the board exports as a picture");
  await act(A, code3, { type: "tier_continue" });
  await waitPhase(A, code3, ["ending"]);
  await act(A, code3, { type: "end" });
  await waitPhase(A, code3, ["finished"]);

  // 4. «خمّن تير صاحبك»
  const target = (await view(B, code3)).me;
  const code4 = await newRoom(A, { kind: "tierlist", count: 2, tier: { style: "guess_friend", topic: { type: "anime" }, source: "any", manual: [], points: true, itemSec: 30, boardSec: 120, target } });
  for (const p of all) await enter(p, code4);
  await sleep(500);
  await act(A, code4, { type: "start" });
  v = await waitPhase(B, code4, ["tier_board"]);
  await B.locator(`text=رتّب لوحتك، والباقين`).waitFor({ timeout: 5000 });
  ok((await A.locator("text=كيف رتّبها Tier-Badr؟").count()) > 0, "the others guess Badr's board");
  const ids4 = v.party.items.map((x) => x.id);
  for (const id of ids4) await act(B, code4, { type: "tier_place", itemId: id, place: "S" });
  for (const id of ids4) await act(A, code4, { type: "tier_place", itemId: id, place: "S" });
  for (const id of ids4) await act(C, code4, { type: "tier_place", itemId: id, place: "F" });
  for (const p of all) await act(p, code4, { type: "tier_submit" });
  v = await waitPhase(A, code4, ["tier_reveal"], 8000);
  const sc = Object.fromEntries(v.players.map((p) => [p.name, p.score]));
  ok(sc["Tier-Ali"] === 200 && sc["Tier-Chad"] === 0 && sc["Tier-Badr"] === 0, `points against the friend's board (${JSON.stringify(sc)})`);
  await act(A, code4, { type: "end" });
  await waitPhase(A, code4, ["finished"]);

  // 5. the archive, «عيدها» and the comparison
  await sleep(1500);
  await A.goto(`${BASE}/tierlists`);
  const rows = await A.locator("ul li a").count();
  ok(rows >= 3, `«تير ليستاتنا» lists the rounds (${rows})`);
  await A.locator("ul li a").filter({ hasText: "كل واحد لوحته" }).first().click();
  await A.locator("text=كل واحد ورأيه").waitFor({ timeout: 8000 });
  ok(true, "an archived tier list shows every player's board");
  await A.click("button:has-text('عيدها')");
  await A.waitForURL(/\/room\//, { timeout: 10000 });
  const code5 = A.url().split("/room/")[1];
  const v5 = await view(A, code5);
  ok(v5.settings.tier.source === "manual" && v5.settings.tier.manual.length === 3 && !!v5.settings.tier.parent, "«عيدها» makes a room with the same items");
  await enter(A, code5);
  await act(A, code5, { type: "start" });
  const w5 = await waitPhase(A, code5, ["tier_board"]);
  for (const it of w5.party.items) await act(A, code5, { type: "tier_place", itemId: it.id, place: "F" });
  await act(A, code5, { type: "tier_submit" });
  await waitPhase(A, code5, ["tier_reveal"]);
  await act(A, code5, { type: "end" });
  await waitPhase(A, code5, ["finished"]);
  await sleep(1500);
  await A.goto(`${BASE}/tierlists`);
  await A.locator("ul li a").filter({ hasText: "إعادة" }).first().click();
  await A.locator("text=وش تغيّر من المرة الأولى").waitFor({ timeout: 8000 });
  ok(true, "the replay compares with the first time");

  // 6. taste: individual tiers became ratings in the watch log
  const log = await C.evaluate(async () => (await fetch("/api/watch")).json());
  ok(Array.isArray(log) ? log.some((e) => e.rating) : JSON.stringify(log).includes("rating"), "individual tiers became ratings (taste, recommendations)");

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
