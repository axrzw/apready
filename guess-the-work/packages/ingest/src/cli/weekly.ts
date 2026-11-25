/**
 * Weekly job: new season, a random sample focused on hidden gems / obscure works, friends' lists, dead links.
 *   pnpm weekly            (run it from cron, or let the web app's scheduler run it: ENABLE_SCHEDULER=1)
 */
import { seeded } from "@gtw/core/rng";
import { SqliteRepo, type Repo } from "@gtw/db";
import { CACHE_DIR, DB_PATH, MEDIA_DIR, ensureProxyEnv } from "../config";
import { Http } from "../http";
import { collectBand, seedAnime } from "../pipeline/anime";
import { checkDeadLinks } from "../pipeline/maintenance";
import { aniListUserIds, malToAniList, malUserIds } from "../sources/lists";
import { num, parseArgs } from "./args";


export function currentSeason(d = new Date()): { season: string; year: number } {
  const m = d.getUTCMonth();
  return { season: ["WINTER", "WINTER", "SPRING", "SPRING", "SPRING", "SUMMER", "SUMMER", "SUMMER", "FALL", "FALL", "FALL", "WINTER"][m], year: m === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear() };
}

export async function runWeekly(argv: string[], repo?: Repo) {
  const a = parseArgs(argv);
  const r = repo ?? new SqliteRepo(DB_PATH);
  const http = new Http({ cacheDir: CACHE_DIR, ttlMs: 86_400_000 });
  const rng = seeded(Date.now());
  const log = (m: string) => console.log(m);
  await r.logJob("weekly", "started");
  const report: Record<string, unknown> = {};

  // 1. this season + 2. a random sample, mostly hidden gems and obscure
  const { season, year } = currentSeason();
  const ids = new Set<number>();
  const season1 = await collectBand(http, { name: "season", vars: { sort: ["POPULARITY_DESC"], season, seasonYear: year }, quota: num(a.season, 100), random: false }, rng, log).catch(() => []);
  season1.forEach((m) => ids.add(m.id));
  for (const band of [
    { name: "gem", vars: { sort: ["SCORE_DESC"], popGreater: 1_500, popLesser: 50_000, scoreGreater: 73 }, quota: num(a.gems, 100), random: true },
    { name: "obscure", vars: { sort: ["POPULARITY_DESC"], popGreater: 400, popLesser: 50_000 }, quota: num(a.obscure, 100), random: true },
    { name: "mid", vars: { sort: ["POPULARITY_DESC"], popGreater: 50_000, popLesser: 250_000 }, quota: num(a.mid, 30), random: true },
  ]) {
    (await collectBand(http, band, rng, log).catch(() => [])).forEach((m) => ids.add(m.id));
  }

  // 3. friends' lists
  const users = await r.listUsers();
  for (const u of users) {
    try {
      if (u.linked?.anilist) (await aniListUserIds(http, u.linked.anilist)).forEach((id) => ids.add(id));
      if (u.linked?.mal && process.env.MAL_CLIENT_ID) (await malToAniList(http, await malUserIds(http, u.linked.mal, process.env.MAL_CLIENT_ID))).forEach((id) => ids.add(id));
    } catch (e) {
      log(`list of ${u.name}: ${(e as Error).message}`);
    }
  }
  report.anime = await seedAnime({ http, repo: r, total: 0, ids: [...ids], rng, log, themes: true });

  // 4. dead links
  report.links = await checkDeadLinks({ repo: r, mediaDir: MEDIA_DIR, sample: num(a.links, 300), rng, log });
  report.counts = await r.counts();
  await r.logJob("weekly", "done", JSON.stringify(report));
  await r.setSetting("lastWeekly", Date.now());
  console.log(JSON.stringify(report));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureProxyEnv();
  runWeekly(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
