import { computeTier } from "@gtw/core/tiers";
import type { Category, Character, Person, Work } from "@gtw/core/types";
import type { Http } from "../http";

export const TMDB = "https://api.themoviedb.org/3";
export const TMDB_IMG = "https://image.tmdb.org/t/p";

export interface TmdbDetails {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview: string;
  genres: { name: string }[];
  vote_average: number;
  vote_count: number;
  poster_path: string | null;
  backdrop_path: string | null;
  runtime?: number;
  number_of_episodes?: number;
  adult?: boolean;
  production_companies?: { name: string }[];
  created_by?: { name: string }[];
  alternative_titles?: { titles?: { title: string; iso_3166_1: string }[]; results?: { title: string; iso_3166_1: string }[] };
  translations?: { translations: { iso_639_1: string; data: { title?: string; name?: string } }[] };
  credits?: { cast: { id: number; name: string; character: string; profile_path: string | null; order: number }[]; crew: { name: string; job: string }[] };
  images?: { backdrops: { file_path: string; iso_639_1: string | null }[] };
  keywords?: { keywords?: { name: string }[]; results?: { name: string }[] };
}

function auth(key: string): Record<string, string> {
  // v4 read access token (long JWT) or v3 api key
  return key.length > 40 ? { authorization: `Bearer ${key}` } : {};
}

function withKey(url: string, key: string) {
  return key.length > 40 ? url : `${url}${url.includes("?") ? "&" : "?"}api_key=${key}`;
}

export async function tmdbDiscover(http: Http, key: string, kind: "movie" | "tv", page: number, extra = "") {
  const url = withKey(`${TMDB}/discover/${kind}?include_adult=false&sort_by=vote_count.desc&page=${page}${extra}`, key);
  return http.json<{ results: { id: number }[]; total_pages: number }>(url, { headers: auth(key) });
}

export async function tmdbDetails(http: Http, key: string, kind: "movie" | "tv", id: number) {
  const url = withKey(`${TMDB}/${kind}/${id}?append_to_response=credits,images,alternative_titles,translations,keywords&include_image_language=null,en`, key);
  return http.json<TmdbDetails>(url, { headers: auth(key) });
}

/** "Chihiro Ogino / Sen (voice)" -> ["Chihiro Ogino", "Sen"] */
function cleanRole(s: string): string[] {
  return s.split("/").map((x) => x.replace(/\((?:voice|uncredited)\)/gi, "").trim()).filter(Boolean);
}

export function mapTmdb(d: TmdbDetails, kind: "movie" | "tv"): { work: Work; characters: Character[]; people: Person[] } | null {
  if (d.adult) return null;
  const category: Category = kind === "movie" ? "movie" : "series";
  const workId = `tmdb-${kind}:${d.id}`;
  const title = d.title ?? d.name ?? "";
  const alt = [...(d.alternative_titles?.titles ?? []), ...(d.alternative_titles?.results ?? [])].map((t) => t.title);
  const ar = d.translations?.translations.find((t) => t.iso_639_1 === "ar");
  const titleAr = ar?.data.title || ar?.data.name || undefined;
  const score = d.vote_average ? Math.round(d.vote_average * 10) : undefined;
  const director = d.credits?.crew.find((c) => c.job === "Director")?.name;
  const cast = (d.credits?.cast ?? []).filter((c) => c.profile_path).slice(0, 8);
  const year = Number((d.release_date ?? d.first_air_date ?? "").slice(0, 4)) || undefined;
  return {
    work: {
      id: workId,
      category,
      title,
      titleAr,
      aliases: [...new Set([d.original_title ?? d.original_name, ...alt].filter((x): x is string => !!x && x !== title))],
      format: kind === "movie" ? "MOVIE" : "TV",
      year,
      genres: d.genres.map((g) => g.name),
      tags: [...(d.keywords?.keywords ?? []), ...(d.keywords?.results ?? [])].slice(0, 10).map((k) => k.name),
      studios: [director, ...(d.created_by ?? []).map((c) => c.name), ...(d.production_companies ?? []).slice(0, 2).map((c) => c.name)].filter((x): x is string => !!x),
      score,
      popularity: d.vote_count,
      tier: computeTier({ category, popularity: d.vote_count, score }),
      episodes: d.number_of_episodes,
      synopsis: d.overview,
      posterUrl: d.poster_path ? `${TMDB_IMG}/w780${d.poster_path}` : undefined,
      bannerUrl: d.backdrop_path ? `${TMDB_IMG}/w1280${d.backdrop_path}` : undefined,
      // backdrops without text (iso_639_1 null) are scene stills
      screenshots: (d.images?.backdrops ?? []).filter((b) => b.iso_639_1 === null).slice(0, 8).map((b) => `${TMDB_IMG}/w1280${b.file_path}`),
      sourceIds: { tmdb: d.id },
    },
    characters: cast
      .filter((c) => c.character && !/himself|herself/i.test(c.character))
      .map((c, i) => ({
        id: `tmdb-char:${kind}:${d.id}:${c.id}`,
        workId,
        name: cleanRole(c.character)[0],
        aliases: cleanRole(c.character).slice(1),
        // TMDB has photos of the actor, used for the actor modes; the character is played by them
        imageUrl: `${TMDB_IMG}/w500${c.profile_path}`,
        role: i < 3 ? "MAIN" : "SUPPORTING",
        voiceActorId: `tmdb-person:${c.id}`,
      })),
    people: cast.map((c) => ({ id: `tmdb-person:${c.id}`, name: c.name, aliases: [], imageUrl: `${TMDB_IMG}/w500${c.profile_path}` })),
  };
}
