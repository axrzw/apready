import { apiUser } from "@/lib/server/session";
import { act, joinRoom, viewRoom, type RoomAction } from "@/lib/server/rooms";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const { code } = await ctx.params;
  let v = viewRoom(code, u.uid);
  if (!v) {
    try {
      joinRoom(code, u);
      v = viewRoom(code, u.uid);
    } catch {
      return Response.json({ error: "الغرفة مو موجودة" }, { status: 404 });
    }
  }
  return Response.json(v, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const { code } = await ctx.params;
  try {
    const result = await act(code, u, (await req.json()) as RoomAction);
    return Response.json({ result, view: viewRoom(code, u.uid) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
