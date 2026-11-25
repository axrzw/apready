import { apiUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { roomForMedia } from "@/lib/server/rooms";

export const runtime = "nodejs";

/** "سؤال خربان": the player reports the current question; the admin sees it with the real answer. */
export async function POST(req: Request) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const { code, questionId, reason } = (await req.json()) as { code: string; questionId: string; reason: string };
  const room = code ? await roomForMedia(String(code).toUpperCase()) : null;
  const q = room?.questions.find((x) => x.id === questionId);
  const rep = await getRepo().addReport({ userId: u.uid, questionKey: q?.key ?? questionId, workId: q?.workId, reason: String(reason ?? "").slice(0, 500) || "-" });
  return Response.json({ ok: true, id: rep.id });
}
