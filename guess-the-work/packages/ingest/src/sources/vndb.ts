import { computeTier } from "@gtw/core/tiers";
import type { Character, Person, Work } from "@gtw/core/types";
import type { Http } from "../http";

export const VNDB = "https://api.vndb.org/kana";

export const VN_FIELDS =
  "title,alttitle,titles.title,titles.latin,aliases,released,rating,votecount,image.url,image.sexual,image.violence,description,developers.name,tags.name,tags.spoiler,tags.rating,screenshots.url,screenshots.sexual,length_minutes,va.character.id,va.character.name,va.character.original,va.character.image.url,va.character.image.sexual,va.staff.id,va.staff.name";

export interface VndbVn {
  id: string;
  title: string;
  alttitle: string | null;
  titles: { title: string; latin: string | null }[];
  aliases: string[];
  released: string | null;
  rating: number | null;
  votecount: number;
  image: { url: string; sexual: number; violence: number } | null;
  description: string | null;
  developers: { name: string }[];
  tags: { name: string; spoiler: number; rating: number }[];
  screenshots: { url: string; sexual: number }[];
  length_minutes: number | null;
  va?: { character: { id: string; name: string; original: string | null; image: { url: string; sexual: number } | null }; staff: { id: string; name: string } }[];
}

const clean = (s: string | null) => s?.replace(/\[url=[^\]]*\]([^[]*)\[\/url\]/g, "$1").replace(/\[\/?[a-z]+\]/g, "").trim();

/** VNs with an explicit cover are skipped entirely; explicit screenshots are dropped. */
export function mapVndb(v: VndbVn): { work: Work; characters: Character[]; people: Person[] } | null {
  if (!v.image || v.image.sexual >= 1 || v.image.violence >= 2) return null;
  const workId = `vndb:${v.id}`;
  const score = v.rating ? Math.round(v.rating) : undefined;
  const names = new Set([v.alttitle, ...v.titles.flatMap((t) => [t.title, t.latin]), ...v.aliases].filter((x): x is string => !!x && x !== v.title));
  const seen = new Set<string>();
  const va = (v.va ?? []).filter((x) => x.character.image && x.character.image.sexual < 1 && !seen.has(x.character.id) && seen.add(x.character.id));
  return {
    work: {
      id: workId,
      category: "vn",
      title: v.title,
      aliases: [...names],
      format: "VN",
      year: v.released && /^\d{4}/.test(v.released) ? Number(v.released.slice(0, 4)) : undefined,
      genres: [],
      tags: v.tags.filter((t) => t.spoiler === 0 && t.rating >= 2).slice(0, 10).map((t) => t.name),
      studios: v.developers.map((d) => d.name),
      score,
      popularity: v.votecount,
      tier: computeTier({ category: "vn", popularity: v.votecount, score }),
      durationHours: v.length_minutes ? Math.round(v.length_minutes / 60) : undefined,
      synopsis: clean(v.description),
      posterUrl: v.image.url,
      screenshots: v.screenshots.filter((s) => s.sexual < 0.5).map((s) => s.url),
      sourceIds: { vndb: v.id },
    },
    characters: va.slice(0, 8).map((x, i) => ({
      id: `vndb-char:${x.character.id}`,
      workId,
      name: x.character.name,
      aliases: [x.character.original].filter((y): y is string => !!y),
      imageUrl: x.character.image!.url,
      role: i < 3 ? "MAIN" : "SUPPORTING",
      voiceActorId: `vndb-staff:${x.staff.id}`,
    })),
    people: va.slice(0, 8).map((x) => ({ id: `vndb-staff:${x.staff.id}`, name: x.staff.name, aliases: [] })),
  };
}

export async function vndbPage(http: Http, page: number, filters: unknown[] = ["and", ["votecount", ">=", 30], ["release", "=", ["minage", "<", 18]]]) {
  const body = JSON.stringify({ filters, fields: VN_FIELDS, sort: "votecount", reverse: true, results: 100, page, count: true });
  return http.json<{ results: VndbVn[]; more: boolean; count?: number }>(`${VNDB}/vn`, { method: "POST", body, headers: { "content-type": "application/json" } });
}
