import { describe, expect, it } from "vitest";
import { groupTier, groupFilter, spoilerSafe, type WatchMap, type WatchStatus } from "../src/group";
import { generateQuestions } from "../src/generate";
import { seeded } from "../src/rng";
import { DEFAULT_TIER_MIX } from "../src/types";
import { makeLibrary } from "./fixtures";

const lib = makeLibrary();
// a, b, c in the room; d is a friend not in the room
const m = (e: [string, WatchStatus][]) => new Map<string, WatchStatus>(e);
const watch: WatchMap = new Map<string, Map<string, WatchStatus>>([
  ["anilist:0", m([["a", "seen"], ["b", "seen"], ["c", "seen"]])],
  ["anilist:1", m([["a", "seen"]])],
  ["anilist:2", m([["a", "seen"], ["b", "watching"]])],
  ["anilist:3", m([["d", "seen"]])],
  ["anilist:4", m([["a", "not_seen"], ["b", "not_seen"]])],
]);

describe("group tiers", () => {
  it("common / niche / unknown from the watch log", () => {
    const group = ["a", "b", "c", "d"];
    expect(groupTier(watch.get("anilist:0"), group)).toBe("group_common");
    expect(groupTier(watch.get("anilist:1"), group)).toBe("group_niche");
    expect(groupTier(watch.get("anilist:4"), group)).toBe("group_unknown");
    expect(groupTier(undefined, group)).toBe("group_unknown");
  });
  it("question source: someone in the room / everyone in the room / anything", () => {
    const room = ["a", "b", "c"];
    const ids = (src: "someone" | "everyone" | "any", exclude = false) =>
      lib.works.filter((w) => groupFilter(w.id, watch, room, { source: src, excludeOwnOnly: exclude })).map((w) => w.id).filter((id) => Number(id.split(":")[1]) < 5);
    expect(ids("someone")).toEqual(["anilist:0", "anilist:1", "anilist:2"]);
    expect(ids("everyone")).toEqual(["anilist:0"]);
    expect(ids("any").length).toBe(5);
    // «استثنِ اللي شافه السائل»: nobody gets a work only they logged
    expect(ids("someone", true)).toEqual(["anilist:0", "anilist:2"]);
  });
  it("no spoilers: no late scenes and no last ending for players watching / not seen", () => {
    const room = ["a", "b"];
    expect(spoilerSafe({ workId: "anilist:2", position: 0.8 }, watch, room)).toBe(false); // b is watching
    expect(spoilerSafe({ workId: "anilist:2", position: 0.3 }, watch, room)).toBe(true);
    expect(spoilerSafe({ workId: "anilist:0", position: 0.9 }, watch, room)).toBe(true); // everyone finished it
    expect(spoilerSafe({ workId: "anilist:4", lastEnding: true }, watch, room)).toBe(false);
    expect(spoilerSafe({ workId: "anilist:4" }, watch, room)).toBe(true);
  });
  it("generateQuestions applies source, years and group tier weights", () => {
    const qs = generateQuestions(lib, {
      modes: ["poster"],
      count: 2,
      mix: DEFAULT_TIER_MIX,
      rng: seeded(1),
      group: { watch, roomPlayers: ["a", "b", "c"], groupPlayers: ["a", "b", "c", "d"], source: "everyone", excludeOwnOnly: false, noSpoilers: true },
    });
    expect(qs.map((q) => q.workId)).toEqual(["anilist:0"]);
    const years = generateQuestions(lib, { modes: ["poster"], count: 5, mix: DEFAULT_TIER_MIX, rng: seeded(2), years: [1995, 1999] });
    expect(years.every((q) => { const y = lib.work.get(q.workId)!.year!; return y >= 1995 && y <= 1999; })).toBe(true);
    // all weight on group_unknown: no work that anyone logged
    const unknown = generateQuestions(lib, {
      modes: ["poster"],
      count: 8,
      mix: DEFAULT_TIER_MIX,
      rng: seeded(3),
      group: { watch, roomPlayers: ["a", "b", "c"], groupPlayers: ["a", "b", "c", "d"], source: "any", excludeOwnOnly: false, noSpoilers: false, mix: { group_common: 0, group_niche: 0, group_unknown: 100 }, weight: 100 },
    });
    expect(unknown.some((q) => ["anilist:0", "anilist:1", "anilist:2", "anilist:3"].includes(q.workId))).toBe(false);
  });
});
