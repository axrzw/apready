import { apiUser } from "@/lib/server/session";
import { act, joinRoom, roomExists, viewRoom, type RoomAction } from "@/lib/server/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Polled by the room page (about once a second). Opening an invite link joins the room. */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const { code } = await ctx.params;
  let v = await viewRoom(code, u.uid);
  if (!v) {
    if (!(await roomExists(code))) return Response.json({ error: "الغرفة مو موجودة" }, { status: 404 });
    await joinRoom(code, u);
    v = await viewRoom(code, u.uid);
  }
  return Response.json(v, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const { code } = await ctx.params;
  try {
    const result = await act(code, u, (await req.json()) as RoomAction);
    return Response.json({ result, view: await viewRoom(code, u.uid) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
