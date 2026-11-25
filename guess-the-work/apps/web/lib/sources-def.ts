import type { Character, Person, Work } from "@gtw/core/types";
import { seeded, shuffle } from "@gtw/core/rng";
import type { Http } from "@gtw/ingest/http";
import { fetchPage, mapMedia } from "@gtw/ingest/sources/anilist";
import { mapTvmaze, tvmazePage } from "@gtw/ingest/sources/tvmaze";
import { mapVndb, vndbPage } from "@gtw/ingest/sources/vndb";
import { mapTmdb, tmdbDetails, tmdbDiscover } from "@gtw/ingest/sources/tmdb";
import { igdbGames, igdbToken, mapIgdb } from "@gtw/ingest/sources/igdb";
import { animeThemes } from "@gtw/ingest/sources/animethemes";
import { arabicNames, WD_PROPS } from "@gtw/ingest/sources/wikidata";
import type { Repo } from "@gtw/db";

/**
 * Library sources the admin (and the weekly cron) can pull on Vercel.
 * Work is split in steps that fit a function call (~40 s); the cursor is saved after every step,
 * so a pull continues where it stopped.
 */
export interface SourceInfo {
  id: string;
  label: string;
  /** env vars it needs (exact names) */
  env: string[];
  missing: string[];
  state: SourceState;
}

export interface SourceState {
  cursor: number;
  total: number;
  added: number;
  status: "idle" | "running" | "done" | "error";
  error?: string;
  seed: number;
  at: number;
}

export type Bundle = { work: Work; characters: Character[]; people: Person[] };
type StepResult = { bundles: Bundle[]; next: number; total: number };

export interface Source {
  id: string;
  label: string;
  env: string[];
  /** steps for one full pull */
  total(env: NodeJS.ProcessEnv): number;
  run(http: Http, cursor: number, seed: number, env: NodeJS.ProcessEnv, repo: Repo): Promise<StepResult>;
}

const PAGES = (n: number, seed: number) => shuffle(Array.from({ length: n }, (_, i) => i + 1), seeded(seed));

// AniList popularity bands (5000 entries max per filtered query = 100 pages of 50)
const ANI_BANDS = [
  { sort: ["POPULARITY_DESC"], popGreater: 250_000, pages: 10 },
  { sort: ["POPULARITY_DESC"], popGreater: 50_000, popLesser: 250_000, pages: 40 },
  { sort: ["SCORE_DESC"], popGreater: 1_500, popLesser: 50_000, scoreGreater: 73, pages: 40 },
  { sort: ["POPULARITY_DESC"], popGreater: 400, popLesser: 50_000, pages: 40 },
];
const aniPlan = (seed: number) => ANI_BANDS.flatMap((b, bi) => PAGES(b.pages, seed + bi).map((page) => ({ bi, page })));

function season(d = new Date()) {
  const m = d.getUTCMonth();
  return { season: ["WINTER", "WINTER", "SPRING", "SPRING", "SPRING", "SUMMER", "SUMMER", "SUMMER", "FALL", "FALL", "FALL", "WINTER"][m], year: m === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear() };
}

const ASIAN = [
  { country: "KR", lang: "ko", subtype: "kdrama" },
  { country: "CN", lang: "zh", subtype: "cdrama" },
  { country: "JP", lang: "ja", subtype: "jdrama" },
  { country: "TH", lang: "th", subtype: "thai" },
];

export const SOURCES: Source[] = [
  {
    id: "anilist",
    label: "AniList: أنمي ودونغوا (عينة من كل الطبقات)",
    env: [],
    total: () => aniPlan(1).length,
    async run(http, cursor, seed) {
      const plan = aniPlan(seed);
      const { bi, page } = plan[cursor];
      const b = ANI_BANDS[bi];
      const pg = await fetchPage(http, { page, sort: b.sort, popGreater: b.popGreater, popLesser: b.popLesser, scoreGreater: b.scoreGreater });
      return { bundles: pg.media.filter((m) => !m.isAdult).map(mapMedia), next: cursor + 1, total: plan.length };
    },
  },
  {
    id: "season",
    label: "AniList: الموسم الحالي",
    env: [],
    total: () => 6,
    async run(http, cursor) {
      const { season: s, year } = season();
      const pg = await fetchPage(http, { page: cursor + 1, season: s, seasonYear: year, sort: ["POPULARITY_DESC"] });
      const bundles = pg.media.filter((m) => !m.isAdult).map((m) => {
        const b = mapMedia(m);
        b.work.airing = true;
        return b;
      });
      return { bundles, next: pg.media.length < 50 ? 6 : cursor + 1, total: 6 };
    },
  },
  {
    id: "animethemes",
    label: "AnimeThemes: أوبننقات وإندنقات الأنمي",
    env: [],
    total: () => 0,
    async run(http, cursor, _seed, _env, repo) {
      // anime without themes yet, 50 per step
      const lib = await repo.loadLibrary();
      const have = new Set(lib.themes.map((t) => t.workId));
      const todo = lib.works.filter((w) => w.category === "anime" && !have.has(w.id) && w.sourceIds?.anilist).sort((a, b) => b.popularity - a.popularity);
      const part = todo.slice(0, 50);
      if (part.length) await repo.upsertThemes(await animeThemes(http, part.map((w) => Number(w.sourceIds!.anilist))));
      const total = cursor + Math.ceil(todo.length / 50);
      return { bundles: [], next: part.length ? cursor + 1 : total, total: Math.max(total, cursor + 1) };
    },
  },
  {
    id: "wikidata",
    label: "Wikidata: الأسماء العربية",
    env: [],
    total: () => 1,
    async run(http, _cursor, _seed, _env, repo) {
      const lib = await repo.loadLibrary();
      const props: [string, (w: Work) => unknown][] = [
        [WD_PROPS.anilist, (w) => w.sourceIds?.anilist],
        [WD_PROPS.mal, (w) => w.sourceIds?.mal],
        [WD_PROPS.tvmaze, (w) => w.sourceIds?.tvmaze],
        [WD_PROPS.vndb, (w) => w.sourceIds?.vndb],
        [WD_PROPS.igdb, (w) => w.sourceIds?.igdb],
        [WD_PROPS.tmdbMovie, (w) => (w.id.startsWith("tmdb-movie") ? w.sourceIds?.tmdb : undefined)],
        [WD_PROPS.tmdbTv, (w) => (w.id.startsWith("tmdb-tv") ? w.sourceIds?.tmdb : undefined)],
      ];
      const changed = new Map<string, Work>();
      for (const [prop, key] of props) {
        const m = await arabicNames(http, prop);
        for (const w of lib.works) {
          const k = key(w);
          const n = k !== undefined ? m.get(String(k)) : undefined;
          if (!n) continue;
          const before = JSON.stringify([w.titleAr, w.aliases]);
          if (n.label && !w.titleAr) w.titleAr = n.label;
          w.aliases = [...new Set([...w.aliases, ...n.aliases])];
          if (JSON.stringify([w.titleAr, w.aliases]) !== before) changed.set(w.id, w);
        }
      }
      await repo.upsertWorks([...changed.values()]);
      return { bundles: [], next: 1, total: 1 };
    },
  },
  {
    id: "tvmaze",
    label: "TVmaze: مسلسلات",
    env: [],
    total: () => 120,
    async run(http, cursor, seed) {
      const page = PAGES(330, seed)[cursor] - 1;
      const shows = await tvmazePage(http, page).catch(() => []);
      const bundles = shows.filter((s) => s.image && ["Scripted", "Animation"].includes(s.type) && !(s.type === "Animation" && s.language === "Japanese") && (s.weight >= 60 || (s.rating.average ?? 0) >= 7.5)).map(mapTvmaze);
      return { bundles, next: cursor + 1, total: 120 };
    },
  },
  {
    id: "vndb",
    label: "VNDB: فجوال نوفل",
    env: [],
    total: () => 15,
    async run(http, cursor) {
      const r = await vndbPage(http, cursor + 1);
      return { bundles: r.results.map(mapVndb).filter((x): x is Bundle => !!x), next: r.more ? cursor + 1 : 15, total: 15 };
    },
  },
  {
    id: "tmdb_movie",
    label: "TMDB: أفلام",
    env: ["TMDB_API_KEY"],
    total: () => 60,
    async run(http, cursor, seed, env) {
      const page = cursor < 15 ? cursor + 1 : 15 + PAGES(400, seed)[cursor - 15];
      const r = await tmdbDiscover(http, env.TMDB_API_KEY!, "movie", page);
      const bundles: Bundle[] = [];
      for (const x of r.results) {
        const m = mapTmdb(await tmdbDetails(http, env.TMDB_API_KEY!, "movie", x.id).catch(() => null as never), "movie");
        if (m?.work.posterUrl) bundles.push(m);
      }
      return { bundles, next: cursor + 1, total: 60 };
    },
  },
  {
    id: "tmdb_tv",
    label: "TMDB: مسلسلات غربية",
    env: ["TMDB_API_KEY"],
    total: () => 40,
    async run(http, cursor, seed, env) {
      const page = cursor < 10 ? cursor + 1 : 10 + PAGES(300, seed)[cursor - 10];
      const r = await tmdbDiscover(http, env.TMDB_API_KEY!, "tv", page, "&without_genres=16&with_original_language=en|es|fr|de|tr|ar");
      const bundles: Bundle[] = [];
      for (const x of r.results) {
        const m = mapTmdb(await tmdbDetails(http, env.TMDB_API_KEY!, "tv", x.id).catch(() => null as never), "tv");
        if (m?.work.posterUrl) bundles.push({ ...m, work: { ...m.work, subtype: "western" } });
      }
      return { bundles, next: cursor + 1, total: 40 };
    },
  },
  {
    id: "tmdb_asian",
    label: "TMDB: دراما كورية وصينية ويابانية وتايلندية",
    env: ["TMDB_API_KEY"],
    total: () => 40,
    async run(http, cursor, _seed, env) {
      const a = ASIAN[cursor % ASIAN.length];
      const page = Math.floor(cursor / ASIAN.length) + 1;
      const r = await tmdbDiscover(http, env.TMDB_API_KEY!, "tv", page, `&with_origin_country=${a.country}&with_original_language=${a.lang}&without_genres=16`);
      const bundles: Bundle[] = [];
      for (const x of r.results) {
        const m = mapTmdb(await tmdbDetails(http, env.TMDB_API_KEY!, "tv", x.id).catch(() => null as never), "tv");
        if (m?.work.posterUrl) bundles.push({ ...m, work: { ...m.work, subtype: a.subtype } });
      }
      return { bundles, next: cursor + 1, total: 40 };
    },
  },
  {
    id: "igdb",
    label: "IGDB: ألعاب",
    env: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"],
    total: () => 8,
    async run(http, cursor, _seed, env) {
      const token = await igdbToken(http, env.TWITCH_CLIENT_ID!, env.TWITCH_CLIENT_SECRET!);
      const games = await igdbGames(http, env.TWITCH_CLIENT_ID!, token, cursor * 500);
      return { bundles: games.map(mapIgdb).filter((w): w is Work => !!w).map((work) => ({ work, characters: [], people: [] })), next: games.length < 500 ? 8 : cursor + 1, total: 8 };
    },
  },
];

