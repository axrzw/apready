import { adminApi } from "@/lib/server/admin";
import { getRepo } from "@/lib/server/repo";
import { getLibrary } from "@/lib/server/library";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const a = await adminApi();
  if (a instanceof Response) return a;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const works = await getRepo().listWorks({ search: q || undefined, limit: 30 });
  const lib = await getLibrary();
  return Response.json(works.map((w) => ({ ...w, characters: (lib.charsByWork.get(w.id) ?? []).slice(0, 12) })));
}
