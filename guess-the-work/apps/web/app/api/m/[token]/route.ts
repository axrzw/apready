import { revealStep } from "@gtw/core/effects";
import type { RoomState } from "@gtw/core/room";
import { readToken, renderAudio, renderImage, loadSource } from "@/lib/server/media";
import { roomForMedia } from "@/lib/server/rooms";
import { getSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const headers = (type: string, cache = "private, max-age=600") => ({ "content-type": type, "cache-control": cache, "x-robots-tag": "noindex", "x-content-type-options": "nosniff" });

/** Highest reveal step allowed right now: the room's clock decides, not the URL. */
function allowedStep(s: RoomState | null, qid: string | undefined, steps: number) {
  if (!s || !qid) return steps - 1;
  const cur = s.questions[s.index];
  if (cur?.id !== qid) return s.questions.findIndex((q) => q.id === qid) > s.index ? 0 : steps - 1;
  if (s.phase !== "question") return steps - 1;
  return revealStep(Date.now() - s.phaseStartedAt, s.phaseEndsAt - s.phaseStartedAt, steps);
}

export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const p = readToken(token);
  if (!p) return new Response("gone", { status: 404 });
  const s = await getSession();
  if (!s) return new Response("login", { status: 401 });
  if (p.u && !p.u.includes(s.uid)) return new Response("not yours", { status: 403 });
  const a = p.a;
  try {
    if (a.type === "image" || a.type === "plain") {
      if (a.type === "plain" && /\.(mp4|webm|m4a|mp3|ogg)$/.test(a.src)) return new Response("no", { status: 400 });
      const asked = Number(new URL(req.url).searchParams.get("s") ?? 0) || 0;
      const step = a.type === "image" ? Math.min(asked, allowedStep(p.r ? await roomForMedia(p.r) : null, p.q, a.steps)) : 0;
      const r = await renderImage(a, step);
      return new Response(new Uint8Array(r.buffer), { headers: headers(r.type) });
    }
    if (a.type === "audio") {
      const buf = await renderAudio(a);
      return new Response(new Uint8Array(buf), { headers: headers("audio/mp4") });
    }
    if (a.type === "video") {
      // only pre-cut scene clips (silent ones have no audio track at all)
      const buf = await loadSource(a.src);
      return new Response(new Uint8Array(buf), { headers: headers("video/mp4") });
    }
  } catch (err) {
    console.error("media", (err as Error).message);
    return new Response("media error", { status: 502 });
  }
  return new Response("?", { status: 400 });
}
