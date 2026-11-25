import type { Http } from "../http";
import { ANILIST_URL } from "./anilist";

/** A friend's AniList list: ids of every anime on it (completed, watching, planning...). */
export const USER_LIST_QUERY = `query ($name: String) {
  MediaListCollection(userName: $name, type: ANIME) { lists { entries { mediaId status score } } }
}`;

export function parseAniListUser(resp: { data: { MediaListCollection: { lists: { entries: { mediaId: number }[] }[] } | null } }): number[] {
  const lists = resp.data.MediaListCollection?.lists ?? [];
  return [...new Set(lists.flatMap((l) => l.entries.map((e) => e.mediaId)))];
}

export async function aniListUserIds(http: Http, name: string): Promise<number[]> {
  const body = JSON.stringify({ query: USER_LIST_QUERY, variables: { name } });
  return parseAniListUser(await http.json(ANILIST_URL, { method: "POST", body, headers: { "content-type": "application/json" }, noCache: true }));
}

/** MyAnimeList official API v2 (needs MAL_CLIENT_ID). Returns MAL ids. */
export function parseMalList(resp: { data: { node: { id: number } }[]; paging?: { next?: string } }): { ids: number[]; next?: string } {
  return { ids: resp.data.map((d) => d.node.id), next: resp.paging?.next };
}

export async function malUserIds(http: Http, name: string, clientId: string): Promise<number[]> {
  const ids: number[] = [];
  let url: string | undefined = `https://api.myanimelist.net/v2/users/${encodeURIComponent(name)}/animelist?limit=1000&nsfw=false`;
  while (url) {
    const r = parseMalList(await http.json(url, { headers: { "X-MAL-CLIENT-ID": clientId }, noCache: true }));
    ids.push(...r.ids);
    url = r.next;
  }
  return ids;
}

/** MAL ids -> AniList ids (AniList accepts idMal_in). */
export const MAL_TO_ANILIST = `query ($ids: [Int]) { Page(perPage: 50) { media(idMal_in: $ids, type: ANIME) { id idMal } } }`;

export async function malToAniList(http: Http, malIds: number[]): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < malIds.length; i += 50) {
    const body = JSON.stringify({ query: MAL_TO_ANILIST, variables: { ids: malIds.slice(i, i + 50) } });
    const r = await http.json<{ data: { Page: { media: { id: number }[] } } }>(ANILIST_URL, { method: "POST", body, headers: { "content-type": "application/json" } });
    out.push(...r.data.Page.media.map((m) => m.id));
  }
  return out;
}
