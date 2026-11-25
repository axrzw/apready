import type { Character, Person, Theme, Work } from "@gtw/core/types";
import type { Repo } from "@gtw/db";
import { normalize } from "@gtw/core/match";
import type { Http } from "../http";
import { fetchPage, mapMedia, type PageVars } from "../sources/anilist";
import { arabicNames, WD_PROPS } from "../sources/wikidata";
import { kitsuAliases } from "../sources/kitsu";
import { animeThemes } from "../sources/animethemes";

export interface Band {
  name: string;
  vars: Omit<PageVars, "page">;
  /** how many works to take from this band */
  quota: number;
  /** random pages (true) or from the top (false) */
  random: boolean;
}

/** Bands so the sample covers famous, middle, hidden gems and obscure works. */
export function animeBands(total: number): Band[] {
  return [
    { name: "mainstream", vars: { sort: ["POPULARITY_DESC"], popGreater: 250_000 }, quota: Math.round(total * 0.15), random: false },
    { name: "mid", vars: { sort: ["POPULARITY_DESC"], popGreater: 50_000, popLesser: 250_000 }, quota: Math.round(total * 0.3), random: true },
    { name: "hidden_gem", vars: { sort: ["SCORE_DESC"], popGreater: 1_500, popLesser: 50_000, scoreGreater: 73 }, quota: Math.round(total * 0.3), random: true },
    { name: "obscure", vars: { sort: ["POPULARITY_DESC"], popGreater: 400, popLesser: 50_000 }, quota: Math.round(total * 0.25), random: true },
  ];
}

export interface SeedLog {
  (msg: string): void;
}

export interface AnimeSeedResult {
  works: number;
  characters: number;
  people: number;
  themes: number;
  arabic: number;
  errors: string[];
}

/**
 * AniList always reports total = 5000 for filtered queries and allows only 100 pages,
 * so the real last page is found with a binary search (about 7 requests).
 */
export async function findLastPage(http: Http, vars: Omit<PageVars, "page">): Promise<number> {
  let lo = 1;
  let hi = 100;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const pg = await fetchPage(http, { ...vars, page: mid });
    if (pg.media.length) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export async function collectBand(http: Http, band: Band, rng: () => number, log: SeedLog) {
  const first = await fetchPage(http, { ...band.vars, page: 1 });
  const lastPage = first.media.length < 50 ? 1 : await findLastPage(http, band.vars);
  log(`  ${band.name}: ${lastPage} pages`);
  const needPages = Math.ceil(band.quota / 50);
  const pages = Array.from({ length: lastPage }, (_, i) => i + 1);
  if (band.random) {
    for (let i = pages.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pages[i], pages[j]] = [pages[j], pages[i]];
    }
  }
  const chosen = pages.slice(0, needPages);
  const media = [...(chosen.includes(1) ? first.media : [])];
  for (const p of chosen) {
    if (p === 1) continue;
    const pg = await fetchPage(http, { ...band.vars, page: p });
    if (!pg.media.length && !band.random) break;
    media.push(...pg.media);
    log(`  ${band.name}: page ${p} (${media.length}/${band.quota})`);
  }
  return media.slice(0, band.quota);
}

export async function seedAnime(o: {
  http: Http;
  repo: Repo;
  total: number;
  rng: () => number;
  log: SeedLog;
  spacetoon?: SpacetoonFile;
  kitsuTop?: number;
  themes?: boolean;
  /** extra AniList ids to pull (friends' lists, new season) */
  ids?: number[];
}): Promise<AnimeSeedResult> {
  const res: AnimeSeedResult = { works: 0, characters: 0, people: 0, themes: 0, arabic: 0, errors: [] };
  const works = new Map<string, Work>();
  const chars: Character[] = [];
  const people = new Map<string, Person>();
  const add = (list: Parameters<typeof mapMedia>[0][]) => {
    for (const m of list) {
      if (m.isAdult) continue;
      const x = mapMedia(m);
      works.set(x.work.id, x.work);
      chars.push(...x.characters);
      for (const p of x.people) people.set(p.id, p);
    }
  };
  if (o.total > 0) {
    let carry = 0;
    for (const band of animeBands(o.total)) {
      band.quota += carry;
      o.log(`AniList band ${band.name} (${band.quota})`);
      try {
        const got = await collectBand(o.http, band, o.rng, o.log);
        carry = Math.max(0, band.quota - got.length);
        add(got);
      } catch (e) {
        res.errors.push(`anilist ${band.name}: ${(e as Error).message}`);
      }
    }
  }
  if (o.ids?.length) {
    for (let i = 0; i < o.ids.length; i += 50) {
      try {
        add((await fetchPage(o.http, { page: 1, ids: o.ids.slice(i, i + 50) })).media);
      } catch (e) {
        res.errors.push(`anilist ids: ${(e as Error).message}`);
      }
    }
  }

  // Arabic names: Wikidata (by AniList and MAL id), then the hand-made dub list
  try {
    const byAl = await arabicNames(o.http, WD_PROPS.anilist);
    const byMal = await arabicNames(o.http, WD_PROPS.mal);
    for (const w of works.values()) {
      const n = byAl.get(String(w.sourceIds?.anilist)) ?? byMal.get(String(w.sourceIds?.mal));
      if (!n) continue;
      if (n.label && !w.titleAr) w.titleAr = n.label;
      w.aliases = [...new Set([...w.aliases, ...n.aliases])];
      res.arabic++;
    }
  } catch (e) {
    res.errors.push(`wikidata: ${(e as Error).message}`);
  }
  if (o.spacetoon) res.arabic += applySpacetoon([...works.values()], chars, o.spacetoon);

  // Kitsu: abbreviations (AoT, SnK...) for the most popular works
  const top = [...works.values()].sort((a, b) => b.popularity - a.popularity).slice(0, o.kitsuTop ?? 0);
  for (const w of top) {
    try {
      const extra = await kitsuAliases(o.http, Number(w.sourceIds?.anilist));
      w.aliases = [...new Set([...w.aliases, ...extra])].filter((a) => a !== w.title);
    } catch (e) {
      res.errors.push(`kitsu ${w.id}: ${(e as Error).message}`);
      break;
    }
  }

  await o.repo.upsertWorks([...works.values()]);
  await o.repo.upsertCharacters(chars);
  await o.repo.upsertPeople([...people.values()]);
  res.works = works.size;
  res.characters = chars.length;
  res.people = people.size;

  if (o.themes) {
    try {
      const ids = [...works.values()].map((w) => Number(w.sourceIds?.anilist)).filter(Boolean);
      const themes: Theme[] = await animeThemes(o.http, ids);
      await o.repo.upsertThemes(themes);
      res.themes = themes.length;
    } catch (e) {
      res.errors.push(`animethemes: ${(e as Error).message}`);
    }
  }
  return res;
}

export interface SpacetoonFile {
  works: { title: string; ar: string[]; characters?: Record<string, string[]> }[];
}

/** Adds the Arabic dub names. A work matches when its title or an alias equals the entry or starts with it. */
export function applySpacetoon(works: Work[], chars: Character[], file: SpacetoonFile): number {
  let n = 0;
  for (const entry of file.works) {
    const key = normalize(entry.title);
    for (const w of works) {
      const names = [w.title, ...w.aliases].map(normalize);
      if (!names.some((x) => x === key || x.startsWith(key + " "))) continue;
      n++;
      if (!w.titleAr) w.titleAr = entry.ar[0];
      w.aliases = [...new Set([...w.aliases, ...entry.ar])];
      for (const [cname, ar] of Object.entries(entry.characters ?? {})) {
        for (const c of chars) {
          if (c.workId !== w.id || normalize(c.name) !== normalize(cname)) continue;
          if (!c.nameAr) c.nameAr = ar[0];
          c.aliases = [...new Set([...c.aliases, ...ar])];
        }
      }
    }
  }
  return n;
}
