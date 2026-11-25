import type { Character, Person, Work } from "@gtw/core/types";
import { computeTier } from "@gtw/core/tiers";
import type { Http } from "../http";

export const ANILIST_URL = "https://graphql.anilist.co";

const MEDIA_FIELDS = `
  id idMal isAdult format season seasonYear episodes duration genres averageScore popularity favourites
  title { romaji english native } synonyms
  description(asHtml: false)
  coverImage { extraLarge large } bannerImage
  tags { name rank isMediaSpoiler isGeneralSpoiler isAdult }
  studios(isMain: true) { nodes { name } }
  staff(sort: [RELEVANCE], perPage: 4) { edges { role node { id name { full native } } } }
  characters(sort: [ROLE, FAVOURITES_DESC], perPage: 10) {
    edges { role
      voiceActors(language: JAPANESE, sort: [RELEVANCE]) { id name { full native alternative } image { large } }
      node { id name { full native alternative first last } image { large } favourites }
    }
  }`;

export const PAGE_QUERY = `query ($page: Int, $perPage: Int, $sort: [MediaSort], $season: MediaSeason, $seasonYear: Int, $ids: [Int], $popGreater: Int, $popLesser: Int, $scoreGreater: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { total lastPage hasNextPage }
    media(type: ANIME, isAdult: false, format_not_in: [MUSIC], sort: $sort, season: $season, seasonYear: $seasonYear, id_in: $ids, popularity_greater: $popGreater, popularity_lesser: $popLesser, averageScore_greater: $scoreGreater) { ${MEDIA_FIELDS} }
  }
}`;

export interface AniMedia {
  id: number;
  idMal: number | null;
  isAdult: boolean;
  format: string | null;
  season: string | null;
  seasonYear: number | null;
  episodes: number | null;
  duration: number | null;
  genres: string[];
  averageScore: number | null;
  popularity: number;
  favourites: number;
  title: { romaji: string | null; english: string | null; native: string | null };
  synonyms: string[];
  description: string | null;
  coverImage: { extraLarge: string | null; large: string | null };
  bannerImage: string | null;
  tags: { name: string; rank: number; isMediaSpoiler: boolean; isGeneralSpoiler: boolean; isAdult: boolean }[];
  studios: { nodes: { name: string }[] };
  staff?: { edges: { role: string; node: { id: number; name: { full: string; native: string | null } } }[] };
  characters: {
    edges: {
      role: "MAIN" | "SUPPORTING" | "BACKGROUND";
      voiceActors: { id: number; name: { full: string; native: string | null; alternative: string[] }; image: { large: string | null } }[];
      node: { id: number; name: { full: string; native: string | null; alternative: string[]; first: string | null; last: string | null }; image: { large: string | null }; favourites: number };
    }[];
  };
}

interface PageResp {
  data: { Page: { pageInfo: { total: number; lastPage: number; hasNextPage: boolean }; media: AniMedia[] } };
}

export interface PageVars { page: number; perPage?: number; sort?: string[]; season?: string; seasonYear?: number; ids?: number[]; popGreater?: number; popLesser?: number; scoreGreater?: number }

export async function fetchPage(http: Http, vars: PageVars) {
  const body = JSON.stringify({ query: PAGE_QUERY, variables: { perPage: 50, sort: ["POPULARITY_DESC"], ...vars } });
  const r = await http.json<PageResp>(ANILIST_URL, { method: "POST", body, headers: { "content-type": "application/json" } });
  return r.data.Page;
}

function cleanText(s: string | null): string | undefined {
  if (!s) return undefined;
  return s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\(Source:[^)]*\)/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** "Doraemon (2005)" is also accepted as "Doraemon" */
export function withoutParens(names: string[]): string[] {
  const out = [...names];
  for (const n of names) {
    const bare = n.replace(/\s*[(（][^)）]*[)）]\s*$/, "").trim();
    if (bare && bare !== n) out.push(bare);
  }
  return uniq(out);
}

function uniq(a: (string | null | undefined)[]): string[] {
  return [...new Set(a.filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim()))];
}

/** "Yeager Eren" style names: also accept the given name alone (≥3 letters) */
function nameParts(n: AniMedia["characters"]["edges"][number]["node"]["name"]): string[] {
  const out = [n.first, n.last].filter((x): x is string => !!x && x.length >= 3);
  if (n.first && n.last) out.push(`${n.last} ${n.first}`);
  return out;
}

export interface Mapped {
  work: Work;
  characters: Character[];
  people: Person[];
}

export function mapMedia(m: AniMedia): Mapped {
  const title = m.title.english ?? m.title.romaji ?? m.title.native ?? `AniList ${m.id}`;
  const bareTitle = title.replace(/\s*[(（][^)）]*[)）]\s*$/, "").trim();
  const workId = `anilist:${m.id}`;
  const score = m.averageScore ?? undefined;
  const author = m.staff?.edges.find((e) => /original creator|story|original story/i.test(e.role))?.node.name.full;
  const work: Work = {
    id: workId,
    category: "anime",
    title,
    aliases: withoutParens([bareTitle, ...uniq([m.title.romaji, m.title.native, m.title.english, ...m.synonyms])]).filter((a) => a !== title),
    format: m.format ?? undefined,
    year: m.seasonYear ?? undefined,
    season: m.season ?? undefined,
    genres: m.genres.filter((g) => g !== "Hentai"),
    tags: m.tags.filter((t) => !t.isMediaSpoiler && !t.isGeneralSpoiler && !t.isAdult && t.rank >= 50).map((t) => t.name),
    studios: m.studios.nodes.map((s) => s.name),
    creators: author ? [author] : [],
    score,
    popularity: m.popularity,
    tier: computeTier({ category: "anime", popularity: m.popularity, score }),
    episodes: m.episodes ?? undefined,
    synopsis: cleanText(m.description),
    posterUrl: m.coverImage.extraLarge ?? m.coverImage.large ?? undefined,
    bannerUrl: m.bannerImage ?? undefined,
    sourceIds: { anilist: m.id, ...(m.idMal ? { mal: m.idMal } : {}) },
    adult: m.isAdult,
  };
  const people = new Map<string, Person>();
  const characters: Character[] = m.characters.edges
    .filter((e) => e.node.image.large && !/default\.jpg$/.test(e.node.image.large))
    .map((e) => {
      const va = e.voiceActors[0];
      if (va) people.set(`anilist-staff:${va.id}`, { id: `anilist-staff:${va.id}`, name: va.name.full, aliases: uniq([va.name.native, ...va.name.alternative]), imageUrl: va.image.large ?? undefined });
      return {
        id: `anilist-char:${e.node.id}:${m.id}`,
        workId,
        name: e.node.name.full,
        aliases: uniq([e.node.name.native, ...e.node.name.alternative, ...nameParts(e.node.name)]).filter((a) => a !== e.node.name.full),
        imageUrl: e.node.image.large ?? undefined,
        role: e.role,
        voiceActorId: va ? `anilist-staff:${va.id}` : undefined,
        favourites: e.node.favourites,
      } satisfies Character;
    });
  return { work, characters, people: [...people.values()] };
}

/**
 * A sample spread over the whole popularity range, not only the top:
 * all of the first `headPages` pages, then random pages further down.
 */
export function plannedPages(lastPage: number, total: number, headPages: number, rng: () => number): number[] {
  const pages = new Set<number>();
  for (let p = 1; p <= Math.min(headPages, lastPage); p++) pages.add(p);
  const want = Math.max(0, total - pages.size);
  const tail: number[] = [];
  for (let p = headPages + 1; p <= lastPage; p++) tail.push(p);
  for (let i = tail.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [tail[i], tail[j]] = [tail[j], tail[i]];
  }
  for (const p of tail.slice(0, want)) pages.add(p);
  return [...pages].sort((a, b) => a - b);
}
