import { apiUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { getLibrary } from "@/lib/server/library";
import { assetUrl } from "@/lib/server/media";
import { seeded, shuffle } from "@gtw/core/rng";
import { CATEGORY_AR } from "@gtw/core/i18n";

export const runtime = "nodejs";

/**
 * Cards for «سجّل اللي شفته»: first what friends logged (most friends first), then a varied sample
 * from every tier, never what I already logged.
 */
export async function GET(req: Request) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const n = Math.min(30, Number(new URL(req.url).searchParams.get("n")) || 12);
  const [lib, all] = await Promise.all([getLibrary(), getRepo().watchAll()]);
  const mine = new Set(all.filter((e) => e.userId === u.uid).map((e) => e.workId));
  const friends = new Map<string, number>();
  for (const e of all) if (e.userId !== u.uid && e.status !== "not_seen") friends.set(e.workId, (friends.get(e.workId) ?? 0) + 1);
  const fromFriends = [...friends.entries()].filter(([id]) => !mine.has(id) && lib.work.has(id)).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const rng = seeded(`${u.uid}|${new Date().toISOString().slice(0, 10)}|${mine.size}`);
  const byTier = ["mainstream", "mid", "hidden_gem", "obscure"].map((t) => shuffle(lib.works.filter((w) => w.tier === t && w.posterUrl && !mine.has(w.id) && !friends.has(w.id)), rng));
  const mixed: string[] = [];
  // mostly famous and mid first (cards people can answer), then gems and obscure
  for (let i = 0; mixed.length < n * 2 && i < 200; i++) for (const [k, list] of byTier.entries()) if (list[i] && (k < 2 || i % 2 === 0)) mixed.push(list[i].id);
  const ids = [...new Set([...fromFriends, ...mixed])].slice(0, n);
  return Response.json(
    ids.map((id) => {
      const w = lib.work.get(id)!;
      return { id, title: w.title, titleAr: w.titleAr, year: w.year, category: CATEGORY_AR[w.category], poster: w.posterUrl ? assetUrl({ a: { type: "plain", src: w.posterUrl } }) : null, friends: friends.get(id) ?? 0 };
    }),
  );
}
