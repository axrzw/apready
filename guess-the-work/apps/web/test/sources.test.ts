import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SOURCES } from "../lib/sources-def";

/** Each source step with recorded API answers (no network, no keys). */
const FX = join(__dirname, "..", "..", "..", "packages", "ingest", "test", "fixtures");
const fx = (n: string) => JSON.parse(readFileSync(join(FX, n), "utf8"));

function fakeHttp(route: (url: string, body?: string) => unknown) {
  return { json: async (url: string, init?: { body?: string }) => route(url, init?.body) } as never;
}
const env = { TMDB_API_KEY: "k", TWITCH_CLIENT_ID: "id", TWITCH_CLIENT_SECRET: "s" } as unknown as NodeJS.ProcessEnv;
const src = (id: string) => SOURCES.find((s) => s.id === id)!;

describe("library sources (fixtures)", () => {
  it("lists the exact env vars each keyed source needs", () => {
    expect(src("tmdb_movie").env).toEqual(["TMDB_API_KEY"]);
    expect(src("tmdb_asian").env).toEqual(["TMDB_API_KEY"]);
    expect(src("igdb").env).toEqual(["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"]);
    expect(src("anilist").env).toEqual([]);
  });
  it("AniList step maps a page and moves the cursor", async () => {
    const r = await src("anilist").run(fakeHttp(() => fx("anilist-page.json")), 0, 7, env, null as never);
    expect(r.bundles.map((b) => b.work.id)).toContain("anilist:16498");
    expect(r.next).toBe(1);
    expect(r.total).toBe(130);
  });
  it("TMDB movie step (discover + details)", async () => {
    const http = fakeHttp((url) => (url.includes("/discover/") ? { results: [{ id: 129 }], total_pages: 500 } : fx("tmdb-movie.json")));
    const r = await src("tmdb_movie").run(http, 0, 1, env, null as never);
    expect(r.bundles[0].work).toMatchObject({ id: "tmdb-movie:129", titleAr: "المخطوفة" });
  });
  it("TMDB Asian drama step marks the sub-type by country", async () => {
    const urls: string[] = [];
    const http = fakeHttp((url) => (urls.push(url), url.includes("/discover/") ? { results: [{ id: 129 }], total_pages: 3 } : fx("tmdb-movie.json")));
    const r = await src("tmdb_asian").run(http, 0, 1, env, null as never);
    expect(urls[0]).toContain("with_origin_country=KR");
    expect(r.bundles[0].work.subtype).toBe("kdrama");
  });
  it("IGDB step", async () => {
    const http = fakeHttp((url) => (url.includes("twitch") ? { access_token: "t" } : fx("igdb-games.json")));
    const r = await src("igdb").run(http, 0, 1, env, null as never);
    expect(r.bundles.map((b) => b.work.id)).toEqual(["igdb:1942"]);
    expect(r.next).toBe(8); // fewer than 500 games: the pull is complete
  });
  it("VNDB and TVmaze steps", async () => {
    const v = await src("vndb").run(fakeHttp(() => ({ ...fx("vndb.json"), more: false })), 0, 1, env, null as never);
    expect(v.bundles.length).toBeGreaterThan(0);
    const t = await src("tvmaze").run(fakeHttp(() => [fx("tvmaze-show.json")]), 0, 1, env, null as never);
    expect(t.bundles[0].work.title).toBe("Game of Thrones");
  });
});
