import { computeTier } from "@gtw/core/tiers";
import type { Work } from "@gtw/core/types";
import type { Http } from "../http";

export const IGDB = "https://api.igdb.com/v4";
export const IGDB_IMG = "https://images.igdb.com/igdb/image/upload";

export interface IgdbGame {
  id: number;
  name: string;
  alternative_names?: { name: string }[];
  first_release_date?: number;
  genres?: { name: string }[];
  themes?: { name: string }[];
  involved_companies?: { developer: boolean; company: { name: string } }[];
  total_rating?: number;
  total_rating_count?: number;
  cover?: { image_id: string };
  screenshots?: { image_id: string }[];
  artworks?: { image_id: string }[];
  summary?: string;
  franchises?: { name: string }[];
}

export const IGDB_FIELDS =
  "name,alternative_names.name,first_release_date,genres.name,themes.name,involved_companies.developer,involved_companies.company.name,total_rating,total_rating_count,cover.image_id,screenshots.image_id,artworks.image_id,summary,franchises.name";

/** Twitch app token for IGDB (client credentials). */
export async function igdbToken(http: Http, clientId: string, secret: string): Promise<string> {
  const r = await http.json<{ access_token: string }>(
    `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${secret}&grant_type=client_credentials`,
    { method: "POST", noCache: true },
  );
  return r.access_token;
}

export async function igdbGames(http: Http, clientId: string, token: string, offset: number, where = "total_rating_count > 5 & version_parent = null & themes != (42)") {
  const body = `fields ${IGDB_FIELDS}; where ${where}; sort total_rating_count desc; limit 500; offset ${offset};`;
  return http.json<IgdbGame[]>(`${IGDB}/games`, { method: "POST", body, headers: { "client-id": clientId, authorization: `Bearer ${token}`, "content-type": "text/plain" } });
}

export function mapIgdb(g: IgdbGame): Work | null {
  if (!g.cover) return null;
  const score = g.total_rating ? Math.round(g.total_rating) : undefined;
  const pop = g.total_rating_count ?? 0;
  return {
    id: `igdb:${g.id}`,
    category: "game",
    title: g.name,
    aliases: [...new Set((g.alternative_names ?? []).map((a) => a.name).filter((n) => n !== g.name))],
    format: "GAME",
    year: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : undefined,
    genres: (g.genres ?? []).map((x) => x.name.replace(/ \(.*\)$/, "")),
    tags: [...(g.themes ?? []).map((t) => t.name), ...(g.franchises ?? []).map((f) => f.name)].slice(0, 10),
    studios: (g.involved_companies ?? []).filter((c) => c.developer).map((c) => c.company.name),
    score,
    popularity: pop,
    tier: computeTier({ category: "game", popularity: pop, score }),
    synopsis: g.summary,
    posterUrl: `${IGDB_IMG}/t_cover_big_2x/${g.cover.image_id}.jpg`,
    screenshots: [...(g.screenshots ?? []), ...(g.artworks ?? [])].slice(0, 8).map((s) => `${IGDB_IMG}/t_1080p/${s.image_id}.jpg`),
    sourceIds: { igdb: g.id },
  };
}
