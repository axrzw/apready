import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Opened } from "../src/client";
import type { Work } from "@gtw/core/types";

let o: Opened;
beforeAll(async () => {
  o = await openDb({ url: "", pgliteDir: "memory://" });
  await o.migrate();
}, 60_000);
afterAll(async () => o.close());

const w = (id: string, extra: Partial<Work> = {}): Work => ({ id, category: "anime", title: id, aliases: [], genres: ["Action"], tags: [], studios: [], popularity: 10, tier: "obscure", year: 2001, ...extra });

describe("PgRepo on PGlite", () => {
  it("keeps hand-added names when a work is pulled again (and migrations are idempotent)", async () => {
    await o.migrate();
    const r = o.repo;
    await r.upsertWorks([w("a", { aliases: ["x"] })]);
    await r.addAlias("work", "a", "كابتن ماجد");
    await r.setArabicName("work", "a", "عنوان");
    await r.upsertWorks([w("a", { aliases: ["y"], popularity: 99 })]);
    const got = await r.getWork("a");
    expect(got?.aliases.sort()).toEqual(["x", "y", "كابتن ماجد"].sort());
    expect(got?.titleAr).toBe("عنوان");
    expect(got?.popularity).toBe(99);
    expect((await r.listWorks({ search: "ماجد" })).length).toBe(1);
  });
  it("answers, seen, leaderboard, stats", async () => {
    const r = o.repo;
    await r.upsertUser({ id: "u1", name: "Ali", color: "#e8b44a" });
    await r.recordAnswer({ userId: "u1", questionKey: "poster:a", mode: "poster", workId: "a", category: "anime", tier: "hidden_gem", correct: true, points: 150, method: "text", hintsUsed: 0, roomCode: "R1", at: 5 });
    await r.recordAnswer({ userId: "u1", questionKey: "tags:b", mode: "tags", workId: "b", category: "game", tier: "mid", correct: false, points: 0, method: "text", hintsUsed: 1, roomCode: "R1", at: 6 });
    await r.recordAnswer({ userId: "u1", questionKey: "d:c", mode: "describer", workId: "c", category: "anime", tier: "mid", correct: true, points: 40, method: "text", hintsUsed: 0, role: "describer", at: 7 });
    expect((await r.seen(["u1"])).get("poster:a")).toBe(5);
    expect((await r.leaderboard())[0]).toMatchObject({ name: "Ali", points: 190 });
    expect((await r.leaderboard({ roomCode: "R1" }))[0].points).toBe(150);
    const st = await r.playerStats("u1");
    expect(st).toMatchObject({ accuracy: 0.5, hiddenGemsKnown: 1, describerPoints: 40, totalPoints: 190 });
    expect((await r.answersOfRoom("R1")).length).toBe(2);
  });
  it("coverage, counts, library", async () => {
    const r = o.repo;
    await r.upsertWorks([w("b2"), w("c2", { tier: "mainstream", year: 1995 })]);
    const cov = await r.coverage();
    expect(cov.find((c) => c.tier === "mainstream")?.decade).toBe(1990);
    expect((await r.loadLibrary()).works.length).toBe((await r.counts()).works);
  });
  it("rooms use compare-and-swap", async () => {
    const r = o.repo;
    expect(await r.saveRoom("ABCDE", { n: 1 }, 0)).toBe(true);
    expect(await r.saveRoom("ABCDE", { n: 1 }, 0)).toBe(false);
    expect((await r.getRoom<{ n: number }>("ABCDE"))?.version).toBe(1);
    expect(await r.saveRoom("ABCDE", { n: 2 }, 1)).toBe(true);
    expect(await r.saveRoom("ABCDE", { n: 3 }, 1)).toBe(false);
    expect((await r.getRoom<{ n: number }>("ABCDE"))?.state.n).toBe(2);
  });
  it("watch log, wishlist, templates, sessions, packs, reports, drawings, settings", async () => {
    const r = o.repo;
    await r.setWatch({ userId: "u1", workId: "a", status: "seen", rating: 9, at: 1 });
    await r.setWatch({ userId: "u1", workId: "a", status: "watching", at: 2 });
    expect(await r.watchOf("u1")).toEqual([{ userId: "u1", workId: "a", status: "watching", rating: undefined, at: 2 }]);
    await r.addWish("u1", "b");
    await r.addWish("u1", "b");
    expect(await r.wishesOf("u1")).toEqual(["b"]);
    await r.saveTemplate({ id: "t1", userId: "u1", name: "سهرة خفيفة", settings: { count: 5 }, at: 1 });
    expect((await r.listTemplates())[0].name).toBe("سهرة خفيفة");
    await r.saveSession({ id: "s1", roomCode: "R1", summary: { ok: 1 }, at: 1 });
    expect((await r.getSession("s1"))?.summary).toEqual({ ok: 1 });
    await r.savePack({ id: "p1", userId: "u1", name: "باقتي", data: { q: [] }, at: 1 });
    expect((await r.listPacks()).length).toBe(1);
    const rep = await r.addReport({ userId: "u", questionKey: "k", reason: "wrong" });
    await r.setReportStatus(rep.id, "fixed");
    expect((await r.listReports("fixed")).length).toBe(1);
    await r.saveDrawing({ id: "d", roomCode: "AB", userId: "u", workId: "a", subject: "s", png: "d.png", votesBest: 0, votesFunny: 0, at: 1 });
    await r.voteDrawing("d", "funny");
    expect((await r.getDrawing("d"))?.votesFunny).toBe(1);
    await r.setSetting("mix", { a: 1 });
    expect(await r.getSetting("mix")).toEqual({ a: 1 });
  });
  it("dump and restore into a fresh database", async () => {
    const d = await o.repo.dump();
    const fresh = await openDb({ url: "", pgliteDir: "memory://" });
    await fresh.migrate();
    await fresh.repo.restore(d);
    expect(await fresh.repo.counts()).toEqual(await o.repo.counts());
    expect((await fresh.repo.leaderboard())[0].points).toBe(190);
    await fresh.repo.recordAnswer({ userId: "u2", questionKey: "x", mode: "poster", workId: "a", category: "anime", tier: "mid", correct: true, points: 1, method: "text", hintsUsed: 0, at: 9 });
    await fresh.close();
  });
});
