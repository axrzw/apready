import type { Http } from "../http";

export const KITSU = "https://kitsu.io/api/edge";

interface KitsuMapping {
  data: { relationships?: unknown }[];
  included?: { type: string; attributes: { titles?: Record<string, string | null>; abbreviatedTitles?: string[] | null; canonicalTitle?: string } }[];
}

/** Extra names (abbreviations like "AoT", other spellings) for an AniList anime. */
export function parseKitsuAliases(resp: KitsuMapping): string[] {
  const out = new Set<string>();
  for (const inc of resp.included ?? []) {
    if (inc.type !== "anime") continue;
    const a = inc.attributes;
    for (const t of Object.values(a.titles ?? {})) if (t) out.add(t);
    for (const t of a.abbreviatedTitles ?? []) if (t) out.add(t);
    if (a.canonicalTitle) out.add(a.canonicalTitle);
  }
  return [...out];
}

export async function kitsuAliases(http: Http, anilistId: number): Promise<string[]> {
  const url = `${KITSU}/mappings?filter[externalSite]=anilist/anime&filter[externalId]=${anilistId}&include=item`;
  return parseKitsuAliases(await http.json<KitsuMapping>(url, { headers: { accept: "application/vnd.api+json" } }));
}
