import { describe, expect, it } from "vitest";
import { closestFriends, highlyRatedUnseen, similarity } from "../src/recommend";

const r = (userId: string, workId: string, rating?: number, status = "seen") => ({ userId, workId, rating, status });
const all = [
  r("me", "w1", 9), r("me", "w2", 3), r("me", "w3", 7),
  r("twin", "w1", 9), r("twin", "w2", 3), r("twin", "w3", 7), r("twin", "w9", 10),
  r("far", "w1", 2), r("far", "w2", 10), r("far", "w3", 1), r("far", "w8", 9),
  r("few", "w1", 9),
];

describe("recommendations", () => {
  it("similarity from shared ratings", () => {
    expect(similarity(all.filter((x) => x.userId === "me"), all.filter((x) => x.userId === "twin"))).toEqual({ score: 1, shared: 3 });
    expect(similarity(all.filter((x) => x.userId === "me"), all.filter((x) => x.userId === "few"))).toBeNull();
    expect(similarity(all.filter((x) => x.userId === "me"), all.filter((x) => x.userId === "far"))!.score).toBeLessThan(0.4);
  });
  it("closest friend first", () => {
    expect(closestFriends(all, "me").map((x) => x.userId)).toEqual(["twin", "far"]);
  });
  it("highly rated by someone, not logged by me", () => {
    expect(highlyRatedUnseen(all, "me").map((p) => p.workId)).toEqual(["w9", "w8"]);
  });
});
