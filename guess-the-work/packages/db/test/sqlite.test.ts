import { describe, expect, it } from "vitest";
import { SqliteRepo } from "../src/sqlite";
import type { Work } from "@gtw/core/types";

const w = (id: string, extra: Partial<Work> = {}): Work => ({
  id, category: "anime", title: id, aliases: [], genres: ["Action"], tags: [], studios: [], popularity: 10, tier: "obscure", year: 2001, ...extra,
});

describe("SqliteRepo", () => {
  it("keeps hand-added names when a work is pulled again", async () => {
    const r = new SqliteRepo(":memory:");
    await r.upsertWorks([w("a", { aliases: ["x"] })]);
    await r.addAlias("work", "a", "كابتن ماجد");
    await r.setArabicName("work", "a", "عنوان");
    await r.upsertWorks([w("a", { aliases: ["y"], popularity: 99 })]);
    const got = await r.getWork("a");
    expect(got?.aliases.sort()).toEqual(["x", "y", "كابتن ماجد"].sort());
    expect(got?.titleAr).toBe("عنوان");
    expect(got?.popularity).toBe(99);
  });
  it("records answers, seen map, leaderboard and stats", async () => {
    const r = new SqliteRepo(":memory:");
    await r.upsertUser({ id: "u1", name: "Ali" });
    await r.recordAnswer({ userId: "u1", questionKey: "poster:a", mode: "poster", workId: "a", category: "anime", tier: "hidden_gem", correct: true, points: 900, method: "text", hintsUsed: 0, at: 5 });
    await r.recordAnswer({ userId: "u1", questionKey: "tags:b", mode: "tags", workId: "b", category: "game", tier: "mid", correct: false, points: 0, method: "text", hintsUsed: 1, at: 6 });
    await r.recordAnswer({ userId: "u1", questionKey: "describer:c", mode: "describer", workId: "c", category: "anime", tier: "mid", correct: true, points: 200, method: "text", hintsUsed: 0, role: "describer", at: 7 });
    expect((await r.seen(["u1"])).get("poster:a")).toBe(5);
    const lb = await r.leaderboard();
    expect(lb[0]).toMatchObject({ name: "Ali", points: 1100 });
    const st = await r.playerStats("u1");
    expect(st.accuracy).toBe(0.5);
    expect(st.hiddenGemsKnown).toBe(1);
    expect(st.describerPoints).toBe(200);
    expect(st.totalPoints).toBe(1100);
  });
  it("coverage groups by category, tier, decade, genre", async () => {
    const r = new SqliteRepo(":memory:");
    await r.upsertWorks([w("a"), w("b"), w("c", { tier: "mainstream", year: 1995 })]);
    const cov = await r.coverage();
    expect(cov.find((c) => c.tier === "obscure")?.count).toBe(2);
    expect(cov.find((c) => c.tier === "mainstream")?.decade).toBe(1990);
  });
  it("reports, drawings, settings", async () => {
    const r = new SqliteRepo(":memory:");
    const rep = await r.addReport({ userId: "u", questionKey: "k", reason: "wrong answer" });
    await r.setReportStatus(rep.id, "fixed");
    expect((await r.listReports("fixed")).length).toBe(1);
    await r.saveDrawing({ id: "d", roomCode: "AB", userId: "u", workId: "a", subject: "s", png: "d.png", votesBest: 0, votesFunny: 0, at: 1 });
    await r.voteDrawing("d", "funny");
    expect((await r.getDrawing("d"))?.votesFunny).toBe(1);
    await r.setSetting("mix", { a: 1 });
    expect(await r.getSetting("mix")).toEqual({ a: 1 });
  });
});
