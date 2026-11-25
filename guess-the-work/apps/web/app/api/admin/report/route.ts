import { adminApi } from "@/lib/server/admin";
import { getRepo } from "@/lib/server/repo";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const a = await adminApi();
  if (a instanceof Response) return a;
  const b = (await req.json()) as { id: string; status: "open" | "fixed" | "ignored" };
  await getRepo().setReportStatus(b.id, b.status);
  return Response.json({ ok: true });
}
