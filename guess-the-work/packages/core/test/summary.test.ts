import { describe, expect, it } from "vitest";
import { buildSummary, titlesFor } from "../src/summary";

const a = (userId: string, q: string, tier: "mainstream" | "obscure" | "mid", correct: boolean, elapsedMs: number, hintsUsed = 0) => ({ userId, questionKey: q, workId: `w-${q}`, mode: "poster", tier, correct, points: correct ? 100 : 0, hintsUsed, elapsedMs });

describe("night summary", () => {
  const s = buildSummary({
    players: [{ id: "a", name: "A", score: 300 }, { id: "b", name: "B", score: 500 }],
    answers: [a("a", "q1", "mainstream", true, 3000), a("b", "q1", "mainstream", true, 1200), a("a", "q2", "obscure", true, 9000, 2), a("b", "q2", "obscure", false, 0), a("a", "q3", "mid", false, 0, 1), a("b", "q3", "mid", false, 0)],
    drawings: [{ id: "d1", userId: "a", votesBest: 2, votesFunny: 0 }, { id: "d2", userId: "b", votesBest: 0, votesFunny: 3 }],
  });
  it("ranking, fastest, hardest, weirdest, drawings, hints", () => {
    expect(s.ranking.map((r) => r.userId)).toEqual(["b", "a"]);
    expect(s.fastest).toMatchObject({ userId: "b", ms: 1200 });
    expect(s.hardest).toMatchObject({ workId: "w-q2", tier: "obscure", solvedBy: ["a"] });
    expect(s.weirdest).toMatchObject({ workId: "w-q3" });
    expect(s.bestDrawing).toMatchObject({ id: "d1", votes: 2 });
    expect(s.funniestDrawing).toMatchObject({ id: "d2" });
    expect(s.mostHints).toEqual({ userId: "a", count: 3 });
    expect(s.questions).toBe(3);
  });
});

describe("titles", () => {
  it("each title goes to the one who earns it", () => {
    const base = { hiddenGemsKnown: 0, drawerPoints: 0, describerPoints: 0, accuracy: 0.5, answers: 30 };
    const t = titlesFor([
      { ...base, userId: "a", obscureKnown: 9, byMode: [{ mode: "opening", correct: 1, answers: 10 }] },
      { ...base, userId: "b", obscureKnown: 2, drawerPoints: 900, byMode: [{ mode: "opening", correct: 9, answers: 10 }] },
    ]);
    expect(t.get("a")).toEqual(["ملك المغمور", "عدو الأوبننقات"]);
    expect(t.get("b")).toEqual(["الرسام الأسطوري", "ملك الأوبننقات"]);
  });
});
