import { apiUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";

export const runtime = "nodejs";

/** Link AniList / MAL (Steam / Letterboxd stored for later). The weekly job adds their works to the library. */
export async function POST(req: Request) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const b = (await req.json()) as { anilist?: string; mal?: string; steam?: string; letterboxd?: string };
  const clean = (v?: string) => (v ?? "").trim().replace(/[^\w.-]/g, "").slice(0, 40) || undefined;
  await getRepo().upsertUser({ id: u.uid, name: u.name, avatar: u.avatar, linked: { anilist: clean(b.anilist), mal: clean(b.mal), steam: clean(b.steam), letterboxd: clean(b.letterboxd) } });
  return Response.json({ ok: true });
}
