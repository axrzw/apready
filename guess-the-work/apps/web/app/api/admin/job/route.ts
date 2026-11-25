import { adminApi, runJob } from "@/lib/server/admin";
import { getRepo } from "@/lib/server/repo";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const a = await adminApi();
  if (a instanceof Response) return a;
  const { name } = (await req.json()) as { name: string };
  try {
    const log = runJob(name);
    await getRepo().logJob(name, "queued", `by ${a.name}`);
    return Response.json({ ok: true, log });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
