import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapTvmaze } from "../src/sources/tvmaze";
import { mapVndb } from "../src/sources/vndb";
import { mapTmdb } from "../src/sources/tmdb";
import { mapIgdb } from "../src/sources/igdb";
import { takeByTier } from "../src/pipeline/others";
import { seeded } from "@gtw/core/rng";

const fx = (n: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", n), "utf8"));

describe("series / VN / movie / game mapping", () => {
  it("TVmaze", () => {
    const m = mapTvmaze(fx("tvmaze-show.json"));
    expect(m.work).toMatchObject({ id: "tvmaze:82", category: "series", title: "Game of Thrones", tier: "mainstream", year: 2011 });
    expect(m.characters[0].name).toBe("Tyrion Lannister");
  });
  it("VNDB skips explicit covers and maps the rest", () => {
    const r = fx("vndb.json").results;
    const ddlc = r.map(mapVndb).find((x: { work: { title: string } } | null) => x?.work.title === "Doki Doki Literature Club!");
    expect(ddlc.work.category).toBe("vn");
    expect(ddlc.work.studios).toContain("Team Salvato");
    expect(mapVndb({ ...r[0], image: { url: "x", sexual: 2, violence: 0 } })).toBeNull();
  });
  it("TMDB with Arabic title, director and textless backdrops", () => {
    const m = mapTmdb(fx("tmdb-movie.json"), "movie")!;
    expect(m.work).toMatchObject({ id: "tmdb-movie:129", titleAr: "المخطوفة", tier: "mainstream", year: 2001 });
    expect(m.work.studios[0]).toBe("Hayao Miyazaki");
    expect(m.work.screenshots).toEqual(["https://image.tmdb.org/t/p/w1280/x.jpg"]);
    expect(m.characters[0]).toMatchObject({ name: "Chihiro Ogino", aliases: ["Sen"] });
  });
  it("IGDB", () => {
    const [w, none] = fx("igdb-games.json").map(mapIgdb);
    expect(w).toMatchObject({ id: "igdb:1942", category: "game", tier: "mainstream", year: 2015, studios: ["CD Projekt RED"] });
    expect(w.aliases).toContain("TW3");
    expect(none).toBeNull();
  });
  it("takes items by tier mix", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ work: { tier: (["mainstream", "mid", "hidden_gem", "obscure"] as const)[i % 4] } as never }));
    const got = takeByTier(items, 20, seeded(1));
    expect(got.length).toBe(20);
  });
});
