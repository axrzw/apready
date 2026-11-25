import { randomUUID } from "node:crypto";
import { apiUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";

export const runtime = "nodejs";

/** Named room setting templates («سهرة خفيفة», «تحدي المغمور»), shared by the group. */
export async function GET() {
  const u = await apiUser();
  if (u instanceof Response) return u;
  return Response.json(await getRepo().listTemplates());
}

export async function POST(req: Request) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const b = (await req.json()) as { name: string; settings: unknown; id?: string; delete?: boolean };
  const repo = getRepo();
  if (b.delete && b.id) {
    await repo.deleteTemplate(b.id);
    return Response.json({ ok: true });
  }
  const name = String(b.name ?? "").trim().slice(0, 40);
  if (!name) return Response.json({ error: "name" }, { status: 400 });
  const t = { id: b.id ?? randomUUID(), userId: u.uid, name, settings: b.settings, at: Date.now() };
  await repo.saveTemplate(t);
  return Response.json(t);
}
