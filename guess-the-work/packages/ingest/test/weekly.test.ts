import { describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseAniListUser, parseMalList } from "../src/sources/lists";
import { currentSeason } from "../src/cli/weekly";
import { checkDeadLinks } from "../src/pipeline/maintenance";
import { openDb } from "@gtw/db";
import { seeded } from "@gtw/core/rng";

const fx = (n: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", n), "utf8"));

describe("friends' lists", () => {
  it("AniList user list -> unique ids", () => {
    expect(parseAniListUser(fx("anilist-user.json")).sort()).toEqual([16498, 21, 5114].sort());
  });
  it("MAL list with paging", () => {
    expect(parseMalList(fx("mal-list.json"))).toMatchObject({ ids: [16498, 5114], next: expect.stringContaining("offset=2") });
  });
});

describe("weekly", () => {
  it("knows the anime season", () => {
    expect(currentSeason(new Date("2026-11-25"))).toEqual({ season: "FALL", year: 2026 });
    expect(currentSeason(new Date("2026-12-25"))).toEqual({ season: "WINTER", year: 2027 });
  });
  it("removes dead posters and missing local files", async () => {
    const o = await openDb({ url: "", pgliteDir: "memory://" });
    await o.migrate();
    const repo = o.repo;
    const dir = mkdtempSync(join(tmpdir(), "gtw-dl-"));
    mkdirSync(join(dir, "frames"));
    writeFileSync(join(dir, "frames", "ok.jpg"), "x");
    const w = (id: string, poster: string) => ({ id, category: "anime" as const, title: id, aliases: [], genres: [], tags: [], studios: [], popularity: 1, tier: "obscure" as const, posterUrl: poster });
    await repo.upsertWorks([w("a", "https://ok/1.jpg"), w("b", "https://dead/2.jpg")]);
    await repo.upsertMedia([
      { id: "m1", workId: "a", kind: "frame", src: "frames/ok.jpg" },
      { id: "m2", workId: "a", kind: "frame", src: "frames/gone.jpg" },
    ]);
    const r = await checkDeadLinks({ repo, mediaDir: dir, sample: 10, rng: seeded(1), log: () => {}, check: async (u) => !u.includes("dead") });
    expect(r).toMatchObject({ deadPosters: 1, deadMedia: 1 });
    expect((await repo.getWork("b"))?.posterUrl).toBeUndefined();
    expect((await repo.loadLibrary()).media.map((m) => m.id)).toEqual(["m1"]);
  });
});

describe("snapshot", () => {
  it("round-trips the library and drops machine-local files", async () => {
    const { packLibrary, unpackLibrary } = await import("../src/cli/snapshot");
    const lib = {
      works: [{ id: "a", category: "anime" as const, title: "A", aliases: ["x"], genres: [], tags: [], studios: [], popularity: 1, tier: "obscure" as const }],
      characters: [],
      people: [],
      themes: [{ id: "admin:1", workId: "a", type: "OST" as const, song: "s", artists: [] }, { id: "t", workId: "a", type: "OP" as const, song: "s", artists: [], audioClip: "themes/t.mp3", audioUrl: "https://a/t.ogg" }],
      media: [{ id: "m", workId: "a", kind: "frame" as const, src: "frames/x.jpg" }, { id: "r", workId: "a", kind: "screenshot" as const, src: "https://x/y.jpg" }],
    };
    const back = unpackLibrary(packLibrary(lib));
    expect(back.works).toEqual(lib.works);
    expect(back.themes.map((t) => t.id)).toEqual(["t"]);
    expect(back.themes[0].audioClip).toBeUndefined();
    expect(back.media.map((m) => m.id)).toEqual(["r"]);
  });
});
