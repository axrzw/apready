import { apiUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";

export const runtime = "nodejs";
const STATUSES = ["seen", "watching", "dropped", "not_seen"] as const;

/** Log a work: seen / watching / dropped / not_seen (+ optional rating 1-10), or null to remove. */
export async function POST(req: Request) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const b = (await req.json()) as { workId: string; status: (typeof STATUSES)[number] | null; rating?: number | null };
  const repo = getRepo();
  if (!b.workId || !(await repo.getWork(b.workId))) return Response.json({ error: "work" }, { status: 400 });
  if (b.status === null) await repo.removeWatch(u.uid, b.workId);
  else {
    if (!STATUSES.includes(b.status)) return Response.json({ error: "status" }, { status: 400 });
    const rating = b.rating ? Math.max(1, Math.min(10, Math.round(b.rating))) : undefined;
    await repo.setWatch({ userId: u.uid, workId: b.workId, status: b.status, rating, at: Date.now() });
  }
  return Response.json({ ok: true });
}

export async function GET() {
  const u = await apiUser();
  if (u instanceof Response) return u;
  return Response.json(await getRepo().watchOf(u.uid));
}
