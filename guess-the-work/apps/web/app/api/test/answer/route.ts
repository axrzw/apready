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
  if (url.searchParams.get("debug") === "sessions") {
    const { getRepo } = await import("@/lib/server/repo");
    const code = String(url.searchParams.get("code"));
    return Response.json({ sessions: await getRepo().listSessions(5), answers: await getRepo().answersOfRoom(code) });
  }
  const s = await roomForMedia(String(url.searchParams.get("code")).toUpperCase());
  const party = s?.party as { item?: { names: string[]; display: { title: string } } } | undefined;
  if (s && party?.item) return Response.json({ phase: s.phase, names: party.item.names, title: party.item.display.title });
  const q = s?.questions[s.index];
  if (!q) return Response.json({ error: "no question", phase: s?.phase }, { status: 404 });
  return Response.json({ id: q.id, mode: q.mode, names: q.names, entity: q.entity, titleAr: q.display.titleAr, title: q.display.title });
}
