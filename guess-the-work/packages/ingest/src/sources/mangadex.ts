import type { Work } from "@gtw/core/types";
import type { Http } from "../http";

/** MangaDex (no key): manga, manhwa, manhua by follows. Safe / suggestive content only. */
export const MANGADEX = "https://api.mangadex.org";

interface MdManga {
  id: string;
  attributes: {
    title: Record<string, string>;
    altTitles: Record<string, string>[];
    year: number | null;
    originalLanguage: string;
    tags: { attributes: { name: { en: string }; group: string } }[];
    description?: Record<string, string>;
  };
  relationships: { type: string; attributes?: { fileName?: string } }[];
}

export function mangadexUrl(offset: number) {
  return `${MANGADEX}/manga?limit=100&offset=${offset}&order[followedCount]=desc&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&hasAvailableChapters=true`;
}

/** Popularity rank (position in the follows order) decides the tier: no score in the list. */
export function mapMangadex(m: MdManga, rank: number): Work | null {
  const a = m.attributes;
  const cover = m.relationships.find((r) => r.type === "cover_art")?.attributes?.fileName;
  if (!cover) return null;
  const names = [...Object.values(a.title), ...a.altTitles.flatMap((t) => Object.values(t))];
  const en = a.altTitles.find((t) => t.en)?.en ?? a.title.en ?? Object.values(a.title)[0];
  const subtype = a.originalLanguage === "ko" ? "manhwa" : a.originalLanguage.startsWith("zh") ? "manhua" : "manga";
  return {
    id: `mangadex:${m.id}`,
    category: "manga",
    subtype,
    title: en,
    aliases: [...new Set(names.filter((n) => n && n !== en))],
    year: a.year ?? undefined,
    genres: a.tags.filter((t) => t.attributes.group === "genre").map((t) => t.attributes.name.en),
    tags: a.tags.filter((t) => t.attributes.group === "theme").map((t) => t.attributes.name.en),
    studios: [],
    popularity: Math.max(1, 100_000 - rank * 20),
    tier: rank < 300 ? "mainstream" : rank < 1500 ? "mid" : "obscure",
    synopsis: a.description?.en,
    posterUrl: `https://uploads.mangadex.org/covers/${m.id}/${cover}.512.jpg`,
    sourceIds: { mangadex: m.id },
  };
}

export async function mangadexPage(http: Http, offset: number): Promise<Work[]> {
  const r = await http.json<{ data: MdManga[] }>(mangadexUrl(offset));
  return r.data.map((m, i) => mapMangadex(m, offset + i)).filter((w): w is Work => !!w);
}
