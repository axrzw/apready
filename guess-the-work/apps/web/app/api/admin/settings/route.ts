import { adminApi } from "@/lib/server/admin";
import { getRepo } from "@/lib/server/repo";
import type { TierMix } from "@gtw/core/types";

export const runtime = "nodejs";

/** Default tier mix for new rooms. */
export async function POST(req: Request) {
  const a = await adminApi();
  if (a instanceof Response) return a;
  const b = (await req.json()) as { mix: TierMix };
  const m = b.mix;
  const clean = { mainstream: +m.mainstream || 0, mid: +m.mid || 0, hidden_gem: +m.hidden_gem || 0, obscure: +m.obscure || 0 };
  await getRepo().setSetting("defaultMix", clean);
  return Response.json({ ok: true, mix: clean });
}
