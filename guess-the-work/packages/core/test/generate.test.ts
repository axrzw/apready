import { describe, expect, it } from "vitest";
import { generateQuestions, availableModes } from "../src/generate";
import { seeded } from "../src/rng";
import { DEFAULT_TIER_MIX } from "../src/types";
import { makeLibrary } from "./fixtures";

const lib = makeLibrary();

describe("generateQuestions", () => {
  it("makes a single-mode game", () => {
    const qs = generateQuestions(lib, { modes: ["poster"], count: 10, mix: DEFAULT_TIER_MIX, rng: seeded(1) });
    expect(qs.length).toBe(10);
    expect(new Set(qs.map((q) => q.workId)).size).toBe(10);
  });
  it("mixes modes", () => {
    const qs = generateQuestions(lib, { modes: ["poster", "tags", "plot", "shadow"], count: 12, mix: DEFAULT_TIER_MIX, rng: seeded(2) });
    expect(qs.length).toBe(12);
    expect(new Set(qs.map((q) => q.mode)).size).toBeGreaterThan(1);
  });
  it("same seed = same daily challenge", () => {
    const a = generateQuestions(lib, { modes: ["poster", "tags"], count: 5, mix: DEFAULT_TIER_MIX, rng: seeded("2026-11-25") }).map((q) => q.key);
    const b = generateQuestions(lib, { modes: ["poster", "tags"], count: 5, mix: DEFAULT_TIER_MIX, rng: seeded("2026-11-25") }).map((q) => q.key);
    expect(a).toEqual(b);
  });
  it("skips modes without material", () => {
    expect(availableModes(lib)).not.toContain("ost");
    expect(generateQuestions(lib, { modes: ["ost"], count: 5, mix: DEFAULT_TIER_MIX, rng: seeded(3) })).toEqual([]);
  });
  it("respects categories", () => {
    const qs = generateQuestions(lib, { modes: ["poster"], count: 3, mix: DEFAULT_TIER_MIX, rng: seeded(4), categories: ["game"] });
    expect(qs.every((q) => q.category === "game")).toBe(true);
  });
});
