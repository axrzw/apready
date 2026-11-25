import { apiUser } from "@/lib/server/session";
import { joinRoom, newRoom, startRoom } from "@/lib/server/rooms";
import type { RoomSettings } from "@gtw/core/room";

export const runtime = "nodejs";

/** Create a room (or a solo game: a room with one player that starts at once). Body: {settings, solo?} or {join: code} */
export async function POST(req: Request) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const body = (await req.json()) as { settings?: Partial<RoomSettings>; solo?: boolean; join?: string };
  try {
    if (body.join) {
      const s = joinRoom(body.join.trim().toUpperCase(), u);
      return Response.json({ code: s.code });
    }
    const s = newRoom(u, sanitize(body.settings ?? {}), body.solo ? "solo" : undefined, body.solo ? `S${crypto.randomUUID().slice(0, 8).toUpperCase()}` : undefined);
    if (body.solo) await startRoom(s.code, u.uid);
    return Response.json({ code: s.code });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

function clamp(n: unknown, lo: number, hi: number, d: number) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d;
}

function sanitize(s: Partial<RoomSettings>): Partial<RoomSettings> {
  const out: Partial<RoomSettings> = { ...s };
  if (s.count !== undefined) out.count = clamp(s.count, 1, 50, 10);
  if (s.timeLimitSec !== undefined) out.timeLimitSec = clamp(s.timeLimitSec, 5, 180, 30);
  if (s.mix) out.mix = { mainstream: clamp(s.mix.mainstream, 0, 100, 25), mid: clamp(s.mix.mid, 0, 100, 30), hidden_gem: clamp(s.mix.hidden_gem, 0, 100, 30), obscure: clamp(s.mix.obscure, 0, 100, 15) };
  return out;
}
