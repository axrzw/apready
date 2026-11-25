/**
 * Seed the library.  pnpm seed -- --anime 3000 --kitsu 200 --themes --media 50 --tvmaze 600 --vndb 400
 * Keyed sources run only when their keys are in the environment (TMDB_API_KEY, TWITCH_CLIENT_ID/SECRET).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { seeded } from "@gtw/core/rng";
import { SqliteRepo, type Repo } from "@gtw/db";
import { CACHE_DIR, DB_PATH, MEDIA_DIR, PROJECT_ROOT, ensureProxyEnv } from "../config";
import { Http } from "../http";
import { seedAnime, type SpacetoonFile } from "../pipeline/anime";
import { processThemes } from "../pipeline/media";
import { seedOthers } from "../pipeline/others";
import { num, parseArgs } from "./args";


export async function runSeed(argv: string[], repo?: Repo) {
  const a = parseArgs(argv);
  const r = repo ?? new SqliteRepo(DB_PATH);
  const http = new Http({ cacheDir: CACHE_DIR, log: (m) => console.log("  http:", m) });
  const rng = seeded(String(a.seed ?? Date.now()));
  const log = (m: string) => console.log(m);
  const spacetoon = JSON.parse(readFileSync(join(PROJECT_ROOT, "packages", "ingest", "data", "spacetoon.json"), "utf8")) as SpacetoonFile;
  await r.logJob("seed", "started", JSON.stringify(a));

  const anime = await seedAnime({ http, repo: r, total: num(a.anime, 3000), rng, log, spacetoon, kitsuTop: num(a.kitsu, 150), themes: a.themes !== "false" });
  console.log("anime:", JSON.stringify(anime));

  const others = await seedOthers({ http, repo: r, rng, log, tvmaze: num(a.tvmaze, 600), vndb: num(a.vndb, 400), tmdb: num(a.tmdb, 1500), igdb: num(a.igdb, 1500) });
  console.log("others:", JSON.stringify(others));

  const mediaN = num(a.media, 0);
  if (mediaN > 0) {
    const lib = await r.loadLibrary();
    const res = await processThemes({ repo: r, mediaDir: MEDIA_DIR, themes: lib.themes.filter((t) => !t.audioClip), limit: mediaN, log });
    console.log("media:", JSON.stringify(res));
  }
  const counts = await r.counts();
  console.log("library:", JSON.stringify(counts));
  await r.logJob("seed", "done", JSON.stringify({ anime, others, counts }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureProxyEnv();
  runSeed(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
