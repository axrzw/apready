import { adminApi } from "@/lib/server/admin";
import { getRepo } from "@/lib/server/repo";
import { invalidateLibrary } from "@/lib/server/library";
import { computeTier } from "@gtw/core/tiers";
import type { Category, Work } from "@gtw/core/types";

export const runtime = "nodejs";

/** Edit names ({kind,id,nameAr?,alias?}) or add a new work by hand ({create: {...}}). */
export async function POST(req: Request) {
  const a = await adminApi();
  if (a instanceof Response) return a;
  const b = (await req.json()) as { kind?: "work" | "character" | "person"; id?: string; nameAr?: string; alias?: string; create?: Partial<Work> & { category: Category; title: string } };
  const repo = getRepo();
  try {
    if (b.create) {
      const c = b.create;
      const w: Work = {
        id: c.id || `manual:${Date.now().toString(36)}`,
        category: c.category,
        title: c.title,
        titleAr: c.titleAr,
        aliases: c.aliases ?? [],
        year: c.year ? Number(c.year) : undefined,
        genres: c.genres ?? [],
        tags: c.tags ?? [],
        studios: c.studios ?? [],
        popularity: Number(c.popularity ?? 0),
        score: c.score ? Number(c.score) : undefined,
        tier: computeTier({ category: c.category, popularity: Number(c.popularity ?? 0), score: c.score ? Number(c.score) : undefined }),
        posterUrl: c.posterUrl,
        synopsis: c.synopsis,
      };
      await repo.upsertWorks([w]);
      invalidateLibrary();
      return Response.json({ ok: true, id: w.id });
    }
    if (!b.kind || !b.id) return Response.json({ error: "kind/id" }, { status: 400 });
    if (b.nameAr) await repo.setArabicName(b.kind, b.id, b.nameAr);
    if (b.alias) await repo.addAlias(b.kind, b.id, b.alias);
    invalidateLibrary();
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
