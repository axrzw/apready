import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapMedia, plannedPages } from "../src/sources/anilist";
import { parseArabic } from "../src/sources/wikidata";
import { parseKitsuAliases } from "../src/sources/kitsu";
import { parseJikanTitles } from "../src/sources/jikan";
import { parseAnimeThemes } from "../src/sources/animethemes";
import { applySpacetoon, animeBands } from "../src/pipeline/anime";
import { matchAnswer } from "@gtw/core/match";

const fx = (n: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", n), "utf8"));

describe("AniList mapping", () => {
  const [aot, dora] = (fx("anilist-page.json").data.Page.media as Parameters<typeof mapMedia>[0][]).map((m) => mapMedia(m));
  it("maps titles, tier, characters and voice actors", () => {
    expect(aot.work.id).toBe("anilist:16498");
    expect(aot.work.title).toBe("Attack on Titan");
    expect(aot.work.aliases).toContain("Shingeki no Kyojin");
    expect(aot.work.tier).toBe("mainstream");
    expect(aot.work.studios).toContain("WIT STUDIO");
    expect(aot.work.synopsis).not.toMatch(/<br|<i>/);
    const eren = aot.characters.find((c: { name: string }) => c.name === "Eren Yeager")!;
    expect(eren.role).toBe("MAIN");
    expect(eren.aliases).toContain("Eren");
    expect(aot.people.find((p: { id: string }) => p.id === eren.voiceActorId)?.name).toBe("Yuuki Kaji");
  });
  it("accepts a title without its (year)", () => {
    expect(dora.work.aliases).toContain("Doraemon");
    expect(matchAnswer("doraemon", [dora.work.title, ...dora.work.aliases]).ok).toBe(true);
  });
  it("plans pages over the whole range", () => {
    const p = plannedPages(100, 10, 3, () => 0.5);
    expect(p.slice(0, 3)).toEqual([1, 2, 3]);
    expect(p.length).toBe(10);
    expect(Math.max(...p)).toBeGreaterThan(3);
  });
  it("splits the anime sample into four bands", () => {
    const b = animeBands(1000);
    expect(b.map((x) => x.quota)).toEqual([150, 300, 300, 250]);
  });
});

describe("other sources", () => {
  it("reads Arabic names from Wikidata", () => {
    const m = parseArabic(fx("wikidata-ar.json"));
    expect(m.get("199")?.label).toBe("المخطوفة");
    expect(m.get("199")?.aliases.length).toBeGreaterThan(0);
  });
  it("reads Kitsu abbreviations", () => {
    expect(parseKitsuAliases(fx("kitsu-mapping.json"))).toContain("AoT");
  });
  it("reads Jikan titles", () => {
    expect(parseJikanTitles(fx("jikan-anime.json").data)).toContain("SnK");
  });
  it("reads AnimeThemes and skips spoilers", () => {
    const t = parseAnimeThemes(fx("animethemes.json"));
    expect(t.map((x) => x.type + x.seq)).toEqual(["OP1", "ED1"]);
    expect(t[0]).toMatchObject({ workId: "anilist:16498", song: "Guren no Yumiya", artists: ["Linked Horizon"] });
    expect(t[0].audioUrl).toMatch(/\.ogg$/);
  });
  it("adds Spacetoon names to works and characters", () => {
    const works = [{ id: "a", category: "anime", title: "Captain Tsubasa", aliases: [], genres: [], tags: [], studios: [], popularity: 1, tier: "mid" } as never];
    const chars = [{ id: "c", workId: "a", name: "Tsubasa Oozora", aliases: [], role: "MAIN" } as never];
    applySpacetoon(works, chars, JSON.parse(readFileSync(join(__dirname, "..", "data", "spacetoon.json"), "utf8")));
    expect((works[0] as { titleAr: string }).titleAr).toBe("كابتن ماجد");
    expect(matchAnswer("ماجد", [(chars[0] as { name: string }).name, ...(chars[0] as { aliases: string[] }).aliases]).ok).toBe(true);
  });
});

describe("findLastPage", () => {
  it("binary-searches the last non-empty page", async () => {
    const { findLastPage } = await import("../src/pipeline/anime");
    const http = { json: async (_u: string, init: { body: string }) => {
      const page = JSON.parse(init.body).variables.page;
      return { data: { Page: { pageInfo: { total: 5000, lastPage: 100, hasNextPage: true }, media: page <= 37 ? [{}] : [] } } };
    } };
    expect(await findLastPage(http as never, {})).toBe(37);
  });
});
