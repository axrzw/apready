/**
 * Seed the library.  pnpm seed -- --anime 3000 --kitsu 200 --themes --media 50 --tvmaze 600 --vndb 400
 * Keyed sources run only when their keys are in the environment (TMDB_API_KEY, TWITCH_CLIENT_ID/SECRET).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { seeded } from "@gtw/core/rng";
import type { Repo } from "@gtw/db";
import { CACHE_DIR, DATA_DIR, MEDIA_DIR, PROJECT_ROOT, ensureProxyEnv, openRepo } from "../config";
import { Http } from "../http";
import { seedAnime, type SpacetoonFile } from "../pipeline/anime";
import { processThemes } from "../pipeline/media";
import { textBoxes, closeOcr } from "../ocr";
import { readFileSync as readFile } from "node:fs";
import { seedOthers } from "../pipeline/others";
import { num, parseArgs } from "./args";


export async function runSeed(argv: string[], repo?: Repo) {
  const a = parseArgs(argv);
  const opened = repo ? null : await openRepo();
  const r = repo ?? opened!.repo;
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
    // frames with clear text (credits, titles) are skipped
    const hasText = async (file: string) => {
      const meta = await (await import("sharp")).default(file).metadata();
      const area = (await textBoxes(readFile(file), `${DATA_DIR}/tessdata`, 70)).reduce((s, b) => s + b.w * b.h, 0);
      return area > 0.01 * (meta.width ?? 1) * (meta.height ?? 1);
    };
    const res = await processThemes({ repo: r, mediaDir: MEDIA_DIR, themes: lib.themes.filter((t) => !t.audioClip), limit: mediaN, log, hasText });
    await closeOcr();
    console.log("media:", JSON.stringify(res));
  }
  const counts = await r.counts();
  console.log("library:", JSON.stringify(counts));
  await r.logJob("seed", "done", JSON.stringify({ anime, others, counts }));
  await opened?.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureProxyEnv();
  runSeed(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
