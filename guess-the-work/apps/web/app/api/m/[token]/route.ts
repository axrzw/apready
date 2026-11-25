import { readFileSync } from "node:fs";
import { getToken, localPath, renderAudio, renderImage } from "@/lib/server/media";
import { getSession } from "@/lib/server/session";

export const runtime = "nodejs";

const headers = (type: string) => ({ "content-type": type, "cache-control": "private, no-store", "x-robots-tag": "noindex" });

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const e = getToken(token);
  if (!e) return new Response("gone", { status: 404 });
  if (e.users) {
    const s = await getSession();
    if (!s || !e.users.includes(s.uid)) return new Response("not yours", { status: 403 });
  }
  const a = e.asset;
  try {
    if (a.type === "image" || a.type === "plain") {
      const step = Number(new URL(req.url).searchParams.get("s") ?? 0) || 0;
      const r = await renderImage(e, step);
      return new Response(new Uint8Array(r.buffer), { headers: headers(r.type) });
    }
    if (a.type === "audio") {
      const file = await renderAudio(a);
      return new Response(new Uint8Array(readFileSync(file)), { headers: headers("audio/mpeg") });
    }
    if (a.type === "video") {
      return new Response(new Uint8Array(readFileSync(localPath(a.src))), { headers: headers("video/mp4") });
    }
  } catch (err) {
    console.error("media", (err as Error).message);
    return new Response("media error", { status: 502 });
  }
  return new Response("?", { status: 400 });
}
