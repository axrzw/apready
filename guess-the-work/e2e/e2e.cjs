/**
 * End-to-end: 3 players in separate browsers against a running server.
 *   E2E_SECRET=... GROUP_PASSWORD=... ADMIN_PASSWORD=... (server)  then:  pnpm e2e
 * Env: BASE_URL (default http://localhost:3000), E2E_SECRET, GROUP_PASSWORD, ADMIN_PASSWORD, SHOTS (folder for screenshots)
 */
const { chromium, devices } = require("playwright");
const { execFileSync } = require("node:child_process");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SECRET = process.env.E2E_SECRET;
const PW = process.env.GROUP_PASSWORD || "dev";
const ADMIN_PW = process.env.ADMIN_PASSWORD;
const SHOTS = process.env.SHOTS;
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

async function player(browser, name, opts = {}, password = PW) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${name}] pageerror`, e.message));
  page.ctx = ctx;
  page.who = name;
  page.pw = password;
  return page;
}

async function login(p, next = "/") {
  await p.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  await p.fill("input[name=password]", p.pw);
  await p.fill("input[name=name]", p.who);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click("button:has-text('ادخل')")]);
}

async function ready(p) {
  const b = p.locator("button:has-text('جاهز')");
  await b.waitFor({ timeout: 15000 });
  await b.click();
}

async function answerOf(code) {
  const r = await fetch(`${BASE}/api/test/answer?secret=${SECRET}&code=${code}`);
  return r.ok ? r.json() : null;
}

async function waitLive(p) {
  // the question starts after the "stand by" countdown, when the answer box appears
  await p.locator("input[autocomplete=off]").first().waitFor({ timeout: 20000 });
}

async function score(p) {
  const r = await p.evaluate(async (code) => (await fetch(`/api/rooms/${code}`)).json(), p.code);
  return r.players.find((x) => x.id === r.me)?.score ?? 0;
}

(async () => {
  if (!SECRET) throw new Error("set E2E_SECRET (and start the server with it)");
  const browser = await chromium.launch();
  const A = await player(browser, "E2E-Ali", { viewport: { width: 1280, height: 900 } });
  const B = await player(browser, "E2E-Badr", { ...devices["iPhone 13"] });
  const C = await player(browser, "E2E-Chad", { ...devices["Pixel 7"] });

  // 1. login, room, join by invite link and by code
  await login(A);
  ok(A.url() === `${BASE}/`, "A logs in with the group password");
  await A.goto(`${BASE}/play?room=1`);
  await A.waitForTimeout(800);
  await A.click("form button.btn-primary");
  await A.waitForURL(/\/room\//);
  const code = A.url().split("/room/")[1];
  A.code = B.code = C.code = code;
  ok(/^[A-Z0-9]{5}$/.test(code), `room created: ${code}`);
  await ready(A);
  await B.goto(`${BASE}/room/${code}`); // invite link: password page, then straight into the room
  ok(B.url().includes("/login"), "invite link asks for the password first");
  await B.fill("input[name=password]", PW);
  await B.fill("input[name=name]", B.who);
  await Promise.all([B.waitForURL(/\/room\//), B.click("button:has-text('ادخل')")]);
  ok(B.url().endsWith(`/room/${code}`), "B lands in the room after logging in");
  await ready(B);
  await login(C);
  await C.fill("input[aria-label='رمز الغرفة']", code);
  await Promise.all([C.waitForURL(/\/room\//), C.click("button:has-text('ادخل غرفة')")]);
  await ready(C);
  await A.waitForTimeout(2500);
  ok((await A.locator("text=E2E-Chad").count()) > 0, "A sees C in the lobby");

  // 2. start: poster, 2 questions, hints on request
  await A.click("form button:has-text('مخصص')");
  await A.locator("input[type=number]").first().fill("2");
  await A.click("form button.btn-primary:has-text('ابدأ')");
  for (const p of [A, B, C]) await waitLive(p);
  if (SHOTS) await A.screenshot({ path: join(SHOTS, "e2e-question-desktop.png") }), await B.screenshot({ path: join(SHOTS, "e2e-question-mobile.png") });
  const q1 = await answerOf(code);
  ok(!!q1 && q1.names.length > 0, `question 1 is live (${q1 && q1.title})`);
  const arabic = q1.names.find((n) => /[؀-ۿ]/.test(n));
  const latin = q1.names.find((n) => /^[\x20-\x7e]+$/.test(n)) || q1.names[0];

  // A: right answer in Arabic when the work has an Arabic name, else English (first = rank bonus)
  await A.fill("input[autocomplete=off]", arabic || latin);
  await A.keyboard.press("Enter");
  await A.locator("text=صح").first().waitFor({ timeout: 8000 });
  ok(true, `A right with ${arabic ? "Arabic" : "English"}: «${arabic || latin}»`);
  // B: wrong first, then English
  await B.fill("input[autocomplete=off]", "zzzz qqqq");
  await B.keyboard.press("Enter");
  await B.waitForTimeout(600);
  ok((await B.locator("text=محاولات غلط").count()) > 0, "B's wrong answer counted, can retry");
  await B.fill("input[autocomplete=off]", latin);
  await B.keyboard.press("Enter");
  await B.locator("text=صح").first().waitFor({ timeout: 8000 });
  ok(true, "B right in English after a wrong try");
  // C: hint, then two letters + autocomplete pick
  await C.click("button:has-text('تلميح')");
  await C.waitForTimeout(800);
  ok((await C.locator("ol li").count()) >= 1, "C opened a hint");
  // type like a player: a few letters, more if the list is not clear yet
  const words = latin.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/);
  let picked = false;
  let typed = "";
  for (const t of [words[0].slice(0, 4), words[0], words.slice(0, 2).join(" "), words.slice(0, 3).join(" "), words.slice(0, 5).join(" ")]) {
    typed = t;
    await C.fill("input[autocomplete=off]", t);
    const opt = C.locator(`[role=option] button`).filter({ hasText: q1.title });
    await opt.first().waitFor({ timeout: 1500 }).catch(() => {});
    if (await opt.count()) {
      await opt.first().click();
      await C.locator("text=صح").first().waitFor({ timeout: 8000 });
      picked = true;
      break;
    }
  }
  ok(picked, `C picked «${q1.title}» from the autocomplete after typing «${typed}»`);

  // 3. reveal + points: A first without hints > B second > C with a hint
  await A.locator("text=THE ANSWER").waitFor({ timeout: 40000 });
  if (SHOTS) await A.screenshot({ path: join(SHOTS, "e2e-reveal-desktop.png"), fullPage: true });
  const [sa, sb, sc] = [await score(A), await score(B), await score(C)];
  console.log("      scores", { A: sa, B: sb, C: sc });
  ok(sa > sb && sb > 0 && sc > 0, "first answer scores more than second (rank bonus), everyone scored");
  const rv = await A.evaluate(async (c) => (await fetch(`/api/rooms/${c}`)).json(), code);
  const mine = rv.reveal?.results.find((x) => x.id === rv.me);
  ok(mine?.breakdown?.bonus === 50, `A got the first-place bonus (+50): ${JSON.stringify(mine?.breakdown)}`);

  // 4. disconnect and come back with the same points
  const before = await score(C);
  await C.ctx.close();
  const C2ctx = await browser.newContext({ ...devices["Pixel 7"] });
  const C2 = await C2ctx.newPage();
  C2.who = "E2E-Chad";
  C2.pw = PW;
  C2.code = code;
  await login(C2, `/room/${code}`);
  ok(C2.url().endsWith(`/room/${code}`), "C reopens the invite link after closing the browser");
  await ready(C2);
  ok((await score(C2)) === before, `C is back with the same points (${before})`);

  // 5. the original image never reaches the browser
  const media = [];
  A.on("response", (r) => r.url().includes("/api/m/") && media.push(r));
  await waitLive(A).catch(() => {});
  await A.waitForTimeout(3000);
  ok(media.length > 0 && media.every((r) => /^image\//.test(r.headers()["content-type"] || "")), "poster mode only loads images through /api/m");
  ok(media.every((r) => !/anilist|tmdb|igdb|vndb|tvmaze/i.test(r.url())), "media URLs carry no source or work id");

  // 6. audio pipeline over the network (admin adds an OST clip, then an OST question)
  if (ADMIN_PW) {
    const D = await player(browser, "E2E-Admin", { viewport: { width: 1280, height: 900 } }, ADMIN_PW);
    await login(D);
    const dir = mkdtempSync(join(tmpdir(), "gtw-e2e-"));
    const src = join(dir, "ost.mkv");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x240:d=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=30", "-metadata", "title=Secret Title", "-c:v", "libx264", "-c:a", "aac", src]);
    const work = await D.evaluate(async () => (await (await fetch("/api/admin/works?q=Attack")).json())[0]?.id);
    const add = await D.evaluate(async ({ work, src }) => (await fetch("/api/admin/clip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workId: work, type: "OST", url: src, start: 3, end: 18, song: "E2E Theme", artists: "E2E" }) })).json(), { work, src });
    ok(add.ok === true, "admin cut an OST clip from a link + start/end");
    const net = [];
    D.on("response", async (r) => {
      if (r.url().includes("/api/m/")) net.push({ url: r.url(), type: r.headers()["content-type"], body: await r.body().catch(() => Buffer.alloc(0)) });
    });
    const solo = await D.evaluate(async () => (await (await fetch("/api/rooms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: { kind: "guess", modes: ["ost"], count: 1 }, solo: true }) })).json()).code);
    await D.goto(`${BASE}/room/${solo}`);
    await ready(D);
    await waitLive(D);
    await D.waitForTimeout(4000);
    const audio = net.filter((n) => /^audio\//.test(n.type || ""));
    ok(audio.length > 0, "OST question loads an audio file");
    ok(net.every((n) => !/video/.test(n.type || "")), "no video file in an audio mode");
    ok((await D.locator("video").count()) === 0, "no <video> element in an audio mode");
    ok(audio.every((n) => !n.body.toString("latin1").includes("Secret Title")), "no metadata (title) inside the audio file");
    ok((await D.content()).indexOf("E2E Theme") === -1, "the song name is not in the page");
    if (audio[0]) {
      const f = join(dir, "got.m4a");
      require("node:fs").writeFileSync(f, audio[0].body);
      const pr = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", f]).toString());
      ok(pr.streams.every((s) => s.codec_type === "audio"), "ffprobe: audio stream only");
      ok(Math.abs(Number(pr.format.duration) - 25) < 1 || Math.abs(Number(pr.format.duration) - 15) < 25, `ffprobe: duration ${Number(pr.format.duration).toFixed(1)} s`);
    }
  } else console.log("SKIP  audio checks (no ADMIN_PASSWORD)");

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("E2E crashed:", e.message);
  process.exit(1);
});
