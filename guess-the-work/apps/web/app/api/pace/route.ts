import { apiUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";

export const runtime = "nodejs";

const KINDS = ["guess", "social", "pack", "describer", "camera", "drawer", "tierlist"];

/** The host's last length / time choice per mode (saved when a game starts). */
export async function GET(req: Request) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const kind = new URL(req.url).searchParams.get("kind") ?? "";
  if (!KINDS.includes(kind)) return Response.json(null);
  return Response.json((await getRepo().getSetting(`pace:${u.uid}:${kind}`)) ?? null, { headers: { "cache-control": "no-store" } });
}
