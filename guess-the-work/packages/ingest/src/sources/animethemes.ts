import type { Theme } from "@gtw/core/types";
import type { Http } from "../http";

export const ANIMETHEMES = "https://api.animethemes.moe";

interface AtResp {
  anime: {
    name: string;
    slug: string;
    resources?: { site: string; external_id: number | null }[];
    animethemes?: {
      type: "OP" | "ED";
      sequence: number | null;
      slug: string;
      song?: { title: string | null; artists?: { name: string }[] } | null;
      animethemeentries?: { version?: number | null; nsfw?: boolean; spoiler?: boolean; videos?: { link: string; basename: string; audio?: { link: string } | null }[] }[];
    }[];
  }[];
}

export function animeThemesUrl(anilistIds: number[]): string {
  const q = new URLSearchParams({
    "filter[has]": "resources",
    "filter[site]": "AniList",
    "filter[external_id]": anilistIds.join(","),
    include: "resources,animethemes.song.artists,animethemes.animethemeentries.videos.audio",
    "page[size]": "100",
  });
  return `${ANIMETHEMES}/anime?${q}`;
}

/** Maps AnimeThemes anime to our themes. Skips NSFW / spoiler entries. */
export function parseAnimeThemes(resp: AtResp): Theme[] {
  const out: Theme[] = [];
  for (const a of resp.anime) {
    const al = a.resources?.find((r) => r.site === "AniList" && r.external_id)?.external_id;
    if (!al) continue;
    for (const t of a.animethemes ?? []) {
      const entry = (t.animethemeentries ?? []).find((e) => !e.nsfw && !e.spoiler && e.videos?.length);
      const video = entry?.videos?.[0];
      if (!video || !t.song?.title) continue;
      out.push({
        id: `animethemes:${a.slug}:${t.slug}`,
        workId: `anilist:${al}`,
        type: t.type,
        seq: t.sequence ?? 1,
        song: t.song.title,
        artists: (t.song.artists ?? []).map((x) => x.name),
        videoUrl: video.link,
        audioUrl: video.audio?.link,
      });
    }
  }
  return out;
}

export async function animeThemes(http: Http, anilistIds: number[]): Promise<Theme[]> {
  const out: Theme[] = [];
  for (let i = 0; i < anilistIds.length; i += 50) {
    out.push(...parseAnimeThemes(await http.json<AtResp>(animeThemesUrl(anilistIds.slice(i, i + 50)))));
  }
  return out;
}
