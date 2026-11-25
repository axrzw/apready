import { adminApi } from "@/lib/server/admin";
import { stepSource } from "@/lib/server/sources";

export const runtime = "nodejs";
export const maxDuration = 60;

/** One batch of a source (about 40 s). The page calls it again until the pull is done. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await adminApi();
  if (a instanceof Response) return a;
  const { id } = await ctx.params;
  const restart = new URL(req.url).searchParams.get("restart") === "1";
  try {
    return Response.json(await stepSource(id, { budgetMs: 40_000, restart }));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
