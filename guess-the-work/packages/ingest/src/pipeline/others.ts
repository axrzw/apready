import type { Character, Person, Tier, Work } from "@gtw/core/types";
import type { Repo } from "@gtw/db";
import { allocate } from "@gtw/core/tiers";
import { DEFAULT_TIER_MIX, TIERS } from "@gtw/core/types";
import { shuffle } from "@gtw/core/rng";
import type { Http } from "../http";
import { mapTvmaze, tvmazeEpisodeImages, tvmazePage, tvmazeShow } from "../sources/tvmaze";
import { mapVndb, vndbPage } from "../sources/vndb";
import { mapTmdb, tmdbDetails, tmdbDiscover } from "../sources/tmdb";
import { igdbGames, igdbToken, mapIgdb } from "../sources/igdb";
import { arabicNames, WD_PROPS } from "../sources/wikidata";

type Bundle = { work: Work; characters: Character[]; people: Person[] };

export interface OthersOpts {
  http: Http;
  repo: Repo;
  rng: () => number;
  log: (m: string) => void;
  tvmaze: number;
  vndb: number;
  tmdb: number;
  igdb: number;
  env?: Record<string, string | undefined>;
}

/** Keep `total` items with the default tier mix (fills from other tiers when one is short). */
export function takeByTier<T extends { work: Work }>(items: T[], total: number, rng: () => number): T[] {
  const quota = allocate(total, DEFAULT_TIER_MIX);
  const by = new Map<Tier, T[]>(TIERS.map((t) => [t, shuffle(items.filter((i) => i.work.tier === t), rng)]));
  const out: T[] = [];
  for (const t of TIERS) out.push(...by.get(t)!.splice(0, quota[t]));
  const rest = shuffle(TIERS.flatMap((t) => by.get(t)!), rng);
  while (out.length < total && rest.length) out.push(rest.pop()!);
  return out;
}

async function save(repo: Repo, list: Bundle[]) {
  await repo.upsertWorks(list.map((b) => b.work));
  await repo.upsertCharacters(list.flatMap((b) => b.characters));
  const people = new Map(list.flatMap((b) => b.people).map((p) => [p.id, p]));
  await repo.upsertPeople([...people.values()]);
}

async function addArabic(http: Http, prop: string, list: Bundle[], key: (w: Work) => string | undefined) {
  const m = await arabicNames(http, prop);
  for (const b of list) {
    const n = m.get(key(b.work) ?? "");
    if (!n) continue;
    if (n.label && !b.work.titleAr) b.work.titleAr = n.label;
    b.work.aliases = [...new Set([...b.work.aliases, ...n.aliases])];
  }
}

export async function seedTvmaze(o: OthersOpts): Promise<number> {
  if (o.tvmaze <= 0) return 0;
  const pages = shuffle(Array.from({ length: 330 }, (_, i) => i), o.rng);
  const pool: Bundle[] = [];
  for (const p of pages) {
    if (pool.length >= o.tvmaze * 4) break;
    let shows;
    try {
      shows = await tvmazePage(o.http, p);
    } catch {
      continue;
    }
    for (const s of shows) {
      if (!s.image || !["Scripted", "Animation"].includes(s.type)) continue;
      if (s.type === "Animation" && s.language === "Japanese") continue; // anime comes from AniList
      pool.push(mapTvmaze(s));
    }
    o.log(`  tvmaze page ${p}: pool ${pool.length}`);
  }
  const chosen = takeByTier(pool, o.tvmaze, o.rng);
  // cast + episode stills for the shows players are likely to know
  for (const b of chosen.filter((x) => x.work.tier !== "obscure").slice(0, 250)) {
    try {
      const full = mapTvmaze(await tvmazeShow(o.http, Number(b.work.sourceIds?.tvmaze)));
      b.characters = full.characters;
      b.people = full.people;
      b.work.screenshots = (await tvmazeEpisodeImages(o.http, Number(b.work.sourceIds?.tvmaze))).slice(0, 12);
    } catch (e) {
      o.log(`  tvmaze ${b.work.id}: ${(e as Error).message}`);
    }
  }
  try {
    await addArabic(o.http, WD_PROPS.tvmaze, chosen, (w) => String(w.sourceIds?.tvmaze));
  } catch (e) {
    o.log(`  wikidata tvmaze: ${(e as Error).message}`);
  }
  await save(o.repo, chosen);
  return chosen.length;
}

export async function seedVndb(o: OthersOpts): Promise<number> {
  if (o.vndb <= 0) return 0;
  const pool: Bundle[] = [];
  const first = await vndbPage(o.http, 1);
  const lastPage = Math.ceil((first.count ?? 100) / 100);
  const pages = [1, 2, 3, ...shuffle(Array.from({ length: Math.max(0, lastPage - 3) }, (_, i) => i + 4), o.rng)];
  for (const p of pages) {
    if (pool.length >= o.vndb * 2) break;
    const r = p === 1 ? first : await vndbPage(o.http, p);
    for (const v of r.results) {
      const m = mapVndb(v);
      if (m) pool.push(m);
    }
    o.log(`  vndb page ${p}: pool ${pool.length}`);
  }
  const chosen = takeByTier(pool, o.vndb, o.rng);
  try {
    await addArabic(o.http, WD_PROPS.vndb, chosen, (w) => String(w.sourceIds?.vndb));
  } catch (e) {
    o.log(`  wikidata vndb: ${(e as Error).message}`);
  }
  await save(o.repo, chosen);
  return chosen.length;
}

export async function seedTmdb(o: OthersOpts, key: string): Promise<number> {
  let n = 0;
  for (const kind of ["movie", "tv"] as const) {
    const want = Math.round(o.tmdb / 2);
    const ids: number[] = [];
    // famous (top pages by votes) + random deeper pages for the rest
    const first = await tmdbDiscover(o.http, key, kind, 1, kind === "tv" ? "&without_genres=16&with_original_language=en|ar|ko|es|fr|tr" : "");
    const last = Math.min(first.total_pages, 500);
    const pages = [1, ...Array.from({ length: 15 }, (_, i) => i + 2), ...shuffle(Array.from({ length: Math.max(0, last - 16) }, (_, i) => i + 17), o.rng)];
    for (const p of pages) {
      if (ids.length >= want * 2) break;
      const r = p === 1 ? first : await tmdbDiscover(o.http, key, kind, p);
      ids.push(...r.results.map((x) => x.id));
    }
    const list: Bundle[] = [];
    for (const id of ids) {
      try {
        const m = mapTmdb(await tmdbDetails(o.http, key, kind, id), kind);
        if (m && m.work.posterUrl) list.push(m);
      } catch (e) {
        o.log(`  tmdb ${kind} ${id}: ${(e as Error).message}`);
      }
    }
    const chosen = takeByTier(list, want, o.rng);
    await save(o.repo, chosen);
    n += chosen.length;
  }
  return n;
}

export async function seedIgdb(o: OthersOpts, clientId: string, secret: string): Promise<number> {
  const token = await igdbToken(o.http, clientId, secret);
  const pool: Bundle[] = [];
  for (let offset = 0; pool.length < o.igdb * 2 && offset < 20_000; offset += 500) {
    const games = await igdbGames(o.http, clientId, token, offset);
    if (!games.length) break;
    for (const g of games) {
      const w = mapIgdb(g);
      if (w) pool.push({ work: w, characters: [], people: [] });
    }
  }
  const chosen = takeByTier(pool, o.igdb, o.rng);
  await save(o.repo, chosen);
  return chosen.length;
}

export async function seedOthers(o: OthersOpts) {
  const env = o.env ?? process.env;
  const res: Record<string, number | string> = {};
  const step = async (name: string, fn: () => Promise<number>) => {
    try {
      res[name] = await fn();
    } catch (e) {
      res[name] = `error: ${(e as Error).message}`;
    }
    o.log(`${name}: ${res[name]}`);
  };
  await step("tvmaze", () => seedTvmaze(o));
  await step("vndb", () => seedVndb(o));
  if (env.TMDB_API_KEY && o.tmdb > 0) await step("tmdb", () => seedTmdb(o, env.TMDB_API_KEY!));
  else res.tmdb = "skipped (no TMDB_API_KEY)";
  if (env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET && o.igdb > 0) await step("igdb", () => seedIgdb(o, env.TWITCH_CLIENT_ID!, env.TWITCH_CLIENT_SECRET!));
  else res.igdb = "skipped (no TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET)";
  return res;
}
