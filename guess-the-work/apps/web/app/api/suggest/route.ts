import { apiUser } from "@/lib/server/session";
import { getLibrary } from "@/lib/server/library";
import { suggest } from "@gtw/core/questions";

export const runtime = "nodejs";

/** Names from the whole library, so a suggestion never gives the answer away. */
export async function GET(req: Request) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const kind = url.searchParams.get("kind") === "character" ? "character" : "work";
  return Response.json(suggest(await getLibrary(), q, kind, 8));
}
