import { adminApi } from "@/lib/server/admin";
import { getRepo } from "@/lib/server/repo";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const a = await adminApi();
  if (a instanceof Response) return a;
  const b = (await req.json()) as { id: string; name?: string; isAdmin?: boolean; kicked?: boolean };
  const repo = getRepo();
  const u = await repo.getUser(b.id);
  if (!u) return Response.json({ error: "not found" }, { status: 404 });
  if (b.id === a.uid && (b.kicked || b.isAdmin === false)) return Response.json({ error: "مو على نفسك" }, { status: 400 });
  await repo.upsertUser({ ...u, name: b.name?.trim().slice(0, 24) || u.name, isAdmin: b.isAdmin ?? u.isAdmin, kicked: b.kicked ?? u.kicked });
  return Response.json({ ok: true });
}
