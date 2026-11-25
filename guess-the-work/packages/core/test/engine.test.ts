import { describe, expect, it } from "vitest";
import { computeTier, allocate, adaptMix } from "../src/tiers";
import { selectQuestions, type Candidate } from "../src/select";
import { seeded } from "../src/rng";
import { buildHints, hintCost } from "../src/hints";
import { DEFAULT_TIER_MIX, type Tier, type Work } from "../src/types";

describe("tiers", () => {
  it("classifies by popularity then score", () => {
    expect(computeTier({ category: "anime", popularity: 1_000_000, score: 85 })).toBe("mainstream");
    expect(computeTier({ category: "anime", popularity: 80_000, score: 60 })).toBe("mid");
    expect(computeTier({ category: "anime", popularity: 9_000, score: 82 })).toBe("hidden_gem");
    expect(computeTier({ category: "anime", popularity: 900, score: 55 })).toBe("obscure");
    expect(computeTier({ category: "game", popularity: 2000 })).toBe("mainstream");
  });
  it("allocates counts with the default mix", () => {
    expect(allocate(20, DEFAULT_TIER_MIX)).toEqual({ mainstream: 5, mid: 6, hidden_gem: 6, obscure: 3 });
    const a = allocate(7, DEFAULT_TIER_MIX);
    expect(Object.values(a).reduce((x, y) => x + y, 0)).toBe(7);
  });
  it("adapts the mix to accuracy", () => {
    expect(adaptMix(DEFAULT_TIER_MIX, 0.9).mainstream).toBe(20);
    expect(adaptMix(DEFAULT_TIER_MIX, 0.2).mainstream).toBe(30);
    expect(adaptMix(DEFAULT_TIER_MIX, 0.5)).toEqual(DEFAULT_TIER_MIX);
  });
});

function pool(): Candidate[] {
  const tiers: Tier[] = ["mainstream", "mid", "hidden_gem", "obscure"];
  const out: Candidate[] = [];
  for (let i = 0; i < 400; i++)
    out.push({ key: `q${i}`, workId: `w${i % 200}`, tier: tiers[i % 4], category: i % 5 ? "anime" : "game", year: 1980 + (i % 45), genres: [`g${i % 7}`], studios: [`s${i % 13}`] });
  return out;
}

describe("selectQuestions", () => {
  it("follows the tier mix and never repeats a work", () => {
    const got = selectQuestions(pool(), { count: 20, mix: DEFAULT_TIER_MIX, rng: seeded(1) });
    expect(got).toHaveLength(20);
    const count = (t: Tier) => got.filter((c) => c.tier === t).length;
    expect([count("mainstream"), count("mid"), count("hidden_gem"), count("obscure")]).toEqual([5, 6, 6, 3]);
    expect(new Set(got.map((c) => c.workId)).size).toBe(20);
  });
  it("is deterministic with the same seed", () => {
    const a = selectQuestions(pool(), { count: 10, mix: DEFAULT_TIER_MIX, rng: seeded("2026-11-25") }).map((c) => c.key);
    const b = selectQuestions(pool(), { count: 10, mix: DEFAULT_TIER_MIX, rng: seeded("2026-11-25") }).map((c) => c.key);
    expect(a).toEqual(b);
  });
  it("skips questions seen recently", () => {
    const p = pool();
    const seen = new Map(p.slice(0, 390).map((c) => [c.key, Date.now()]));
    const got = selectQuestions(p, { count: 3, mix: { mainstream: 0, mid: 0, hidden_gem: 0, obscure: 100 }, rng: seeded(3), seen });
    expect(got.every((c) => !seen.has(c.key))).toBe(true);
  });
  it("still returns a game when the library is smaller than asked or a tier is empty", () => {
    const small = pool().filter((c) => c.tier === "mid").slice(0, 3);
    const got = selectQuestions(small, { count: 10, mix: DEFAULT_TIER_MIX, rng: seeded(4) });
    expect(got.length).toBe(3);
    const seen = new Map(small.map((c) => [c.key, Date.now()]));
    expect(selectQuestions(small, { count: 2, mix: DEFAULT_TIER_MIX, rng: seeded(4), seen }).length).toBe(2);
  });
  it("filters by category", () => {
    const got = selectQuestions(pool(), { count: 8, mix: DEFAULT_TIER_MIX, rng: seeded(5), categories: ["game"] });
    expect(got.every((c) => c.category === "game")).toBe(true);
  });
});

const work: Work = {
  id: "anilist:16498", category: "anime", title: "Attack on Titan", titleAr: "هجوم العمالقة",
  aliases: ["Shingeki no Kyojin"], format: "TV", year: 2013, season: "SPRING", genres: ["Action", "Drama"],
  tags: ["Military", "Shingeki Lore"], studios: ["Wit Studio"], score: 85, popularity: 1_000_000, tier: "mainstream", episodes: 25,
};

describe("hints", () => {
  const names = [work.title, work.titleAr!, ...work.aliases];
  const hints = buildHints(work, { acceptedNames: names, mainVoiceActor: { name: "Yuki Kaji", nameAr: "يوكي كاجي" } });
  it("goes from general to precise", () => {
    expect(hints.map((h) => h.kind)).toEqual(["format", "year", "genres", "tags", "studio", "stats", "voice", "letters"]);
    expect(hints[0].ar).toContain("أنمي");
    expect(hints[1].ar).toBe("الربيع 2013");
    expect(hints[7].ar).toContain("أول حرف «ه»");
    for (let i = 1; i < hints.length; i++) expect(hints[i].cost).toBeGreaterThanOrEqual(hints[i - 1].cost);
  });
  it("never shows an accepted name", () => {
    const tagHint = hints.find((h) => h.kind === "tags")!;
    expect(tagHint.en).not.toMatch(/Shingeki/);
    for (const h of hints.filter((h) => h.kind !== "letters")) {
      expect(h.en).not.toMatch(/Attack on Titan/i);
    }
  });
  it("sums costs", () => {
    expect(hintCost(hints, 2)).toBeCloseTo(0.2);
    expect(hints.at(-1)!.cost).toBe(0.25);
  });
});
