import type { Character, Person, Tier, Work } from "@gtw/core/types";
import type { Http } from "../http";

export const TVMAZE = "https://api.tvmaze.com";

export interface TvmShow {
  id: number;
  name: string;
  type: string;
  language: string | null;
  genres: string[];
  premiered: string | null;
  rating: { average: number | null };
  weight: number;
  network?: { name: string } | null;
  webChannel?: { name: string } | null;
  image?: { original: string; medium: string } | null;
  summary: string | null;
  externals?: { imdb: string | null; thetvdb: number | null };
  _embedded?: { cast?: { person: { id: number; name: string; image?: { medium: string } | null }; character: { id: number; name: string; image?: { medium: string; original: string } | null } }[] };
}

/** TVmaze "weight" (0-100) is its popularity score. */
export function tvmazeTier(weight: number, rating: number | null): Tier {
  if (weight >= 97) return "mainstream";
  if (weight >= 88) return "mid";
  if ((rating ?? 0) >= 7.6) return "hidden_gem";
  return "obscure";
}

export function mapTvmaze(s: TvmShow): { work: Work; characters: Character[]; people: Person[] } {
  const workId = `tvmaze:${s.id}`;
  const score = s.rating.average ? Math.round(s.rating.average * 10) : undefined;
  const cast = s._embedded?.cast ?? [];
  return {
    work: {
      id: workId,
      category: "series",
      title: s.name,
      aliases: [],
      format: s.type,
      year: s.premiered ? Number(s.premiered.slice(0, 4)) : undefined,
      genres: s.genres,
      tags: [],
      studios: [s.network?.name ?? s.webChannel?.name].filter((x): x is string => !!x),
      score,
      popularity: s.weight * 50,
      tier: tvmazeTier(s.weight, s.rating.average),
      synopsis: s.summary?.replace(/<[^>]+>/g, "").trim(),
      posterUrl: s.image?.original,
      sourceIds: { tvmaze: s.id, ...(s.externals?.imdb ? { imdb: s.externals.imdb } : {}) },
    },
    characters: cast
      .filter((c) => c.character.image)
      .slice(0, 8)
      .map((c, i) => ({
        id: `tvmaze-char:${c.character.id}`,
        workId,
        name: c.character.name,
        aliases: c.character.name.split(" ").filter((p) => p.length >= 4 && i < 4),
        imageUrl: c.character.image?.original,
        role: i < 3 ? "MAIN" : "SUPPORTING",
        voiceActorId: `tvmaze-person:${c.person.id}`,
      })),
    people: cast.slice(0, 8).map((c) => ({ id: `tvmaze-person:${c.person.id}`, name: c.person.name, aliases: [], imageUrl: c.person.image?.medium })),
  };
}

/** A page of the TVmaze index (250 shows, by id). */
export async function tvmazePage(http: Http, page: number): Promise<TvmShow[]> {
  return http.json<TvmShow[]>(`${TVMAZE}/shows?page=${page}`);
}

export async function tvmazeShow(http: Http, id: number): Promise<TvmShow> {
  return http.json<TvmShow>(`${TVMAZE}/shows/${id}?embed[]=cast`);
}

export async function tvmazeEpisodeImages(http: Http, id: number): Promise<string[]> {
  const eps = await http.json<{ image?: { original: string } | null }[]>(`${TVMAZE}/shows/${id}/episodes`);
  return eps.map((e) => e.image?.original).filter((x): x is string => !!x);
}
