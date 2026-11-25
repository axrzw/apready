import { apiUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";

export const runtime = "nodejs";

/** «أبي أشوفه» */
export async function POST(req: Request) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const b = (await req.json()) as { workId: string; on: boolean };
  if (b.on) await getRepo().addWish(u.uid, b.workId);
  else await getRepo().removeWish(u.uid, b.workId);
  return Response.json({ ok: true });
}
