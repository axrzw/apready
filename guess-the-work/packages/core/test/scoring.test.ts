import { describe, expect, it } from "vitest";
import { DEFAULT_SCORING, hintCostAt, hintMultiplier, scoreAnswer } from "../src/scoring";

const base = { correct: true, elapsedMs: 0, timeLimitMs: 30_000, tier: "mainstream" as const, method: "text" as const, hintsUsed: 0, streak: 0, rank: 99 };

describe("scoring (SPEC 11, final values)", () => {
  it("base 100 x difficulty", () => {
    expect(scoreAnswer({ ...base }).total).toBe(100);
    expect(scoreAnswer({ ...base, tier: "mid" }).total).toBe(125);
    expect(scoreAnswer({ ...base, tier: "hidden_gem" }).total).toBe(150);
    expect(scoreAnswer({ ...base, tier: "obscure" }).total).toBe(175);
  });
  it("speed falls linearly from 100% to 50%", () => {
    expect(scoreAnswer({ ...base, elapsedMs: 15_000 }).total).toBe(75);
    expect(scoreAnswer({ ...base, elapsedMs: 30_000 }).total).toBe(50);
    expect(scoreAnswer({ ...base, elapsedMs: 99_000 }).total).toBe(50);
  });
  it("pick-from-4 is half, typing and autocomplete are full", () => {
    expect(scoreAnswer({ ...base, method: "choice" }).total).toBe(50);
    expect(scoreAnswer({ ...base, method: "autocomplete" }).total).toBe(100);
  });
  it("hints: 10% each for 1-4, 15% for 5-7, 25% for the last, floor 20%", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((i) => hintCostAt(i - 1, 8))).toEqual([0.1, 0.1, 0.1, 0.1, 0.15, 0.15, 0.15, 0.25]);
    expect(hintMultiplier(2, 8)).toBeCloseTo(0.8);
    expect(hintMultiplier(8, 8)).toBe(0.2); // 1 - 1.1 -> floor
    expect(scoreAnswer({ ...base, hintsUsed: 3 }).total).toBe(70);
  });
  it("streak +10% per correct in a row, max +50%", () => {
    expect(scoreAnswer({ ...base, streak: 2 }).total).toBe(120);
    expect(scoreAnswer({ ...base, streak: 9 }).total).toBe(150);
  });
  it("rank bonus +50/+25/+10 after everything, cancelled by any hint", () => {
    expect(scoreAnswer({ ...base, rank: 1 }).total).toBe(150);
    expect(scoreAnswer({ ...base, rank: 2 }).total).toBe(125);
    expect(scoreAnswer({ ...base, rank: 3 }).total).toBe(110);
    expect(scoreAnswer({ ...base, rank: 4 }).total).toBe(100);
    expect(scoreAnswer({ ...base, rank: 1, hintsUsed: 1 }).total).toBe(90);
  });
  it("wrong is zero, first-only gives nothing after the first", () => {
    expect(scoreAnswer({ ...base, correct: false }).total).toBe(0);
    expect(scoreAnswer({ ...base, rank: 2, firstOnly: true }).total).toBe(0);
    expect(scoreAnswer({ ...base, rank: 1, firstOnly: true }).total).toBe(150);
  });
  it("everything combined, rounded, with a breakdown", () => {
    const r = scoreAnswer({ ...base, tier: "hidden_gem", elapsedMs: 6_000, hintsUsed: 0, streak: 1, rank: 1 });
    // 150 * 0.9 * 1.1 = 148.5 -> 149, + 50
    expect(r).toMatchObject({ base: 150, speed: 0.9, method: 1, hints: 1, streak: 1.1, bonus: 50, total: 199 });
  });
  it("the admin can change the numbers", () => {
    expect(scoreAnswer({ ...base, rank: 1 }, { ...DEFAULT_SCORING, base: 200, rankBonus: [100, 0, 0] }).total).toBe(300);
  });
});
