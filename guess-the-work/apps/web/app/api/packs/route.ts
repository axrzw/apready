import { randomUUID } from "node:crypto";
import { apiUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { getLibrary } from "@/lib/server/library";
import { modesForWork, type PackData } from "@gtw/core/packs";
import { GUESS_MODES } from "@gtw/core/generate";
import type { ModeId } from "@gtw/core/types";

export const runtime = "nodejs";

/** My logged works with the modes each can be asked in (for the pack builder). */
export async function GET() {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const [lib, log] = await Promise.all([getLibrary(), getRepo().watchOf(u.uid)]);
  const usable = GUESS_MODES.filter((m) => !["higher_lower", "timeline", "common_link", "odd_one"].includes(m));
  return Response.json(
    log
      .filter((e) => e.status !== "not_seen" && lib.work.has(e.workId))
      .slice(0, 200)
      .map((e) => {
        const w = lib.work.get(e.workId)!;
        return { workId: w.id, title: w.titleAr || w.title, modes: modesForWork(lib, w.id, usable) };
      })
      .filter((x) => x.modes.length),
  );
}

export async function POST(req: Request) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const b = (await req.json()) as { name: string; items: { workId: string; mode: ModeId }[]; difficulty: PackData["difficulty"] };
  const name = String(b.name ?? "").trim().slice(0, 40);
  const items = (b.items ?? []).filter((i) => i.workId && GUESS_MODES.includes(i.mode)).slice(0, 40);
  if (!name || !items.length) return Response.json({ error: "اسم وعناصر" }, { status: 400 });
  const pack = { id: randomUUID().slice(0, 8), userId: u.uid, name, data: { items, difficulty: ["easy", "normal", "hard"].includes(b.difficulty) ? b.difficulty : "normal" } satisfies PackData, at: Date.now() };
  await getRepo().savePack(pack);
  return Response.json(pack);
}
