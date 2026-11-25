import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { adminApi, resolveMediaUrl } from "@/lib/server/admin";
import { getRepo } from "@/lib/server/repo";
import { invalidateLibrary } from "@/lib/server/library";
import { MEDIA_DIR } from "@/lib/server/env";
import { clipAudio, clipVideo, grabFrame } from "@gtw/ingest/media";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Admin tool: a link (direct file, or YouTube & co. when yt-dlp is installed) + start/end.
 * The server cuts it and keeps it (private use between us). type: OST (audio), scene (video clip, silent + sound), frame.
 */
export async function POST(req: Request) {
  const a = await adminApi();
  if (a instanceof Response) return a;
  const b = (await req.json()) as { workId: string; type: "OST" | "OP" | "ED" | "scene" | "frame"; url: string; start: number; end: number; song?: string; artists?: string };
  const repo = getRepo();
  const work = await repo.getWork(b.workId);
  if (!work) return Response.json({ error: "العمل مو موجود" }, { status: 400 });
  const start = Math.max(0, Number(b.start) || 0);
  const dur = Math.min(60, Math.max(1, (Number(b.end) || start + 20) - start));
  const id = randomBytes(6).toString("hex");
  try {
    if (b.type === "OST" || b.type === "OP" || b.type === "ED") {
      const src = resolveMediaUrl(b.url, true);
      const rel = join("admin", `${id}.mp3`);
      await clipAudio({ input: src, out: join(MEDIA_DIR, rel), start, duration: dur });
      await repo.upsertThemes([{ id: `admin:${id}`, workId: work.id, type: b.type, seq: 1, song: b.song?.trim() || "?", artists: (b.artists ?? "").split(",").map((x) => x.trim()).filter(Boolean), audioClip: rel }]);
    } else if (b.type === "scene") {
      const src = resolveMediaUrl(b.url, false);
      const silent = join("admin", `${id}-silent.mp4`);
      const sound = join("admin", `${id}.mp4`);
      await clipVideo({ input: src, out: join(MEDIA_DIR, silent), start, duration: Math.min(dur, 8), mute: true });
      await clipVideo({ input: src, out: join(MEDIA_DIR, sound), start, duration: Math.min(dur, 8) });
      await repo.upsertMedia([
        { id: `clip_silent:admin_${id}:0`, workId: work.id, kind: "clip_silent", src: silent, meta: { theme: `admin:${id}` } },
        { id: `clip:admin_${id}:0`, workId: work.id, kind: "clip", src: sound, meta: { theme: `admin:${id}` } },
      ]);
    } else {
      const src = resolveMediaUrl(b.url, false);
      const rel = join("admin", `${id}.jpg`);
      await grabFrame(src, start, join(MEDIA_DIR, rel));
      await repo.upsertMedia([{ id: `frame:admin_${id}:0`, workId: work.id, kind: "frame", src: rel }]);
    }
    invalidateLibrary();
    return Response.json({ ok: true, id });
  } catch (e) {
    return Response.json({ error: (e as Error).message.split("\n")[0] }, { status: 400 });
  }
}
