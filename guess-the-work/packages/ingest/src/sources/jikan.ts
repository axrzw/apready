import type { Http } from "../http";

/** Jikan (unofficial MyAnimeList API). Used to add titles/synonyms and MAL popularity. */
export const JIKAN = "https://api.jikan.moe/v4";

export interface JikanAnime {
  mal_id: number;
  titles: { type: string; title: string }[];
  members: number;
  score: number | null;
  rating?: string | null;
  year?: number | null;
}

export function parseJikanTitles(a: JikanAnime): string[] {
  return [...new Set(a.titles.map((t) => t.title).filter(Boolean))];
}

export async function jikanAnime(http: Http, malId: number): Promise<JikanAnime> {
  const r = await http.json<{ data: JikanAnime }>(`${JIKAN}/anime/${malId}`);
  return r.data;
}

/** A page of the MAL ranking by members, for sampling outside AniList. */
export async function jikanTop(http: Http, page: number): Promise<JikanAnime[]> {
  const r = await http.json<{ data: JikanAnime[] }>(`${JIKAN}/top/anime?filter=bypopularity&sfw=true&page=${page}`);
  return r.data;
}
