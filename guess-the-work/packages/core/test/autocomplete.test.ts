import { describe, expect, it } from "vitest";
import { buildIndex, searchIndex, skeleton, type IndexItem } from "../src/autocomplete";

const items: IndexItem[] = [
  { id: "w:naruto", label: "Naruto", names: ["Naruto", "ナルト"], pop: 900 },
  { id: "w:naruto-sh", label: "Naruto: Shippuden", names: ["Naruto: Shippuden", "Naruto Shippuuden"], pop: 800 },
  { id: "w:aot", label: "Attack on Titan", labelAr: "هجوم العمالقة", names: ["Attack on Titan", "Shingeki no Kyojin", "進撃の巨人", "هجوم العمالقة"], pop: 1000 },
  { id: "w:hxh", label: "Hunter x Hunter (2011)", names: ["Hunter x Hunter (2011)", "Hunter x Hunter", "HxH"], pop: 950 },
  { id: "w:op", label: "ONE PIECE", names: ["ONE PIECE", "One Piece"], pop: 990 },
  { id: "w:ds", label: "Demon Slayer: Kimetsu no Yaiba", names: ["Demon Slayer: Kimetsu no Yaiba", "Kimetsu no Yaiba"], pop: 970 },
  { id: "w:fma", label: "Fullmetal Alchemist: Brotherhood", names: ["Fullmetal Alchemist: Brotherhood", "Hagane no Renkinjutsushi: Fullmetal Alchemist", "FMAB"], pop: 960 },
  { id: "w:csm", label: "Chainsaw Man", names: ["Chainsaw Man"], pop: 700 },
  { id: "w:hunter-x", label: "Hunterz", names: ["Hunterz"], pop: 1 },
];
const idx = buildIndex(items);
const ids = (q: string, n = 5) => searchIndex(idx, q, n).map((r) => r.id);

describe("autocomplete", () => {
  it("transliterates Arabic to Latin names", () => {
    expect(ids("ناروتو")[0]).toBe("w:naruto");
    expect(ids("ون بيس")[0]).toBe("w:op");
    expect(ids("كيمتسو")).toContain("w:ds");
    expect(ids("هنتر")[0]).toBe("w:hxh");
    expect(ids("شينجيكي")).toContain("w:aot");
  });
  it("matches abbreviations and other languages", () => {
    expect(ids("AOT")[0]).toBe("w:aot");
    expect(ids("snk")[0]).toBe("w:aot");
    expect(ids("hunter")[0]).toBe("w:hxh");
    expect(ids("هجوم")[0]).toBe("w:aot");
    expect(ids("fmab")[0]).toBe("w:fma");
  });
  it("starts from any word and forgives typos", () => {
    expect(ids("alchemist")[0]).toBe("w:fma");
    expect(ids("shipuden")).toContain("w:naruto-sh");
    expect(ids("chainsow")).toContain("w:csm");
    expect(ids("kimetsu")).toContain("w:ds");
  });
  it("needs two letters", () => {
    expect(ids("n")).toEqual([]);
  });
  it("shows which name matched, with the matched part", () => {
    const r = searchIndex(idx, "shingeki", 3)[0];
    expect(r).toMatchObject({ id: "w:aot", label: "Attack on Titan", matched: "Shingeki no Kyojin" });
    expect(r.matched.slice(r.hl[0], r.hl[1]).toLowerCase()).toBe("shingeki");
  });
  it("ranking depends only on the typed text (not on order, not on any question)", () => {
    const shuffled = buildIndex([...items].reverse());
    for (const q of ["na", "hunter", "ون", "aot", "kim"]) expect(searchIndex(shuffled, q, 8)).toEqual(searchIndex(idx, q, 8));
  });
  it("searches 20,000 names in under 50 ms", () => {
    const many: IndexItem[] = Array.from({ length: 20_000 }, (_, i) => ({ id: `x${i}`, label: `Series ${i} ${["Blade", "Moon", "Sky", "Ninja", "Dragon"][i % 5]} Story`, names: [`Series ${i} ${["Blade", "Moon", "Sky", "Ninja", "Dragon"][i % 5]} Story`], pop: i }));
    const big = buildIndex(many);
    searchIndex(big, "warm", 8);
    for (const q of ["dr", "drago", "نينجا", "seris 19", "moon st"]) {
      const t0 = performance.now();
      searchIndex(big, q, 8);
      expect(performance.now() - t0, q).toBeLessThan(50);
    }
  });
  it("skeletons line up across scripts", () => {
    expect(skeleton("naruto")).toBe(skeleton("ناروتو"));
    expect(skeleton("hunter")).toBe(skeleton("هنتر"));
    expect(skeleton("one piece")).toBe(skeleton("ون بيس"));
  });
});
