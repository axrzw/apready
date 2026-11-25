import { apiUser } from "@/lib/server/session";
import { getLibrary } from "@/lib/server/library";
import { candidatesFor, MODES } from "@gtw/core/questions";

export const runtime = "nodejs";

/** How much material each mode has right now (the setup page greys out empty modes). */
export async function GET() {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const lib = await getLibrary();
  const counts = Object.fromEntries(MODES.map((m) => [m.id, candidatesFor(m.id, lib).length]));
  return Response.json({ counts, works: lib.works.length });
}
