import { roomForMedia } from "@/lib/server/rooms";

export const runtime = "nodejs";

/**
 * E2E only: the accepted names of the current question. Exists only when E2E_SECRET is set
 * (never set it on Vercel) and needs that secret.
 */
export async function GET(req: Request) {
  const secret = process.env.E2E_SECRET;
  const url = new URL(req.url);
  if (!secret || url.searchParams.get("secret") !== secret) return new Response("not found", { status: 404 });
  const s = await roomForMedia(String(url.searchParams.get("code")).toUpperCase());
  const q = s?.questions[s.index];
  if (!q) return Response.json({ error: "no question" }, { status: 404 });
  return Response.json({ id: q.id, mode: q.mode, names: q.names, entity: q.entity, titleAr: q.display.titleAr, title: q.display.title });
}
