import { createHash } from "node:crypto";
import { apiUser } from "@/lib/server/session";
import { getLibrary } from "@/lib/server/library";
import type { IndexItem } from "@gtw/core/autocomplete";
import { characterNames, workNames, type LibraryIndex } from "@gtw/core/library";

export const runtime = "nodejs";

type Kind = "work" | "character" | "song";
const cache = new WeakMap<LibraryIndex, Map<Kind, { etag: string; body: string }>>();

/** Compact rows: [id, label, labelAr, popularity, names[]] */
function build(lib: LibraryIndex, kind: Kind): (string | number | string[])[][] {
  const rows: IndexItem[] =
    kind === "work"
      ? lib.works.map((w) => ({ id: w.id, label: w.title, labelAr: w.titleAr, names: workNames(w), pop: w.popularity }))
      : kind === "character"
        ? lib.characters.filter((c) => lib.work.has(c.workId)).map((c) => ({ id: c.id, label: c.name, labelAr: c.nameAr, names: characterNames(c), pop: c.favourites ?? lib.work.get(c.workId)!.popularity / 100 }))
        : [
            ...lib.themes.map((t) => ({ id: `song:${t.id}`, label: t.song, names: [t.song], pop: lib.work.get(t.workId)?.popularity ?? 0 })),
            ...[...new Set(lib.themes.flatMap((t) => t.artists))].map((a) => ({ id: `artist:${a}`, label: a, names: [a], pop: 1 })),
          ];
  return rows.map((r) => [r.id, r.label, r.labelAr ?? "", Math.round(r.pop), r.names.filter((n) => n !== r.label && n !== r.labelAr)]);
}

/**
 * The whole library's names for the autocomplete (SPEC 10). Same file for every question and every player,
 * so having it reveals nothing; the browser caches it and searches locally.
 */
export async function GET(req: Request) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const k = new URL(req.url).searchParams.get("kind");
  const kind: Kind = k === "character" || k === "song" ? k : "work";
  const lib = await getLibrary();
  let m = cache.get(lib);
  if (!m) cache.set(lib, (m = new Map()));
  let hit = m.get(kind);
  if (!hit) {
    const body = JSON.stringify(build(lib, kind));
    hit = { body, etag: `"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"` };
    m.set(kind, hit);
  }
  if (req.headers.get("if-none-match") === hit.etag) return new Response(null, { status: 304, headers: { etag: hit.etag } });
  return new Response(hit.body, { headers: { "content-type": "application/json", etag: hit.etag, "cache-control": "private, max-age=3600" } });
}
