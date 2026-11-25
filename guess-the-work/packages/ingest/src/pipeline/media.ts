import { join } from "node:path";
import type { MediaAsset, Theme } from "@gtw/core/types";
import type { Repo } from "@gtw/db";
import { clipAudio, clipStarts, clipVideo, extractFrames, probeDuration } from "../media";

export interface MediaJobOpts {
  repo: Repo;
  mediaDir: string;
  themes: Theme[];
  limit: number;
  framesPerVideo?: number;
  clipsPerVideo?: number;
  hasText?: (file: string) => Promise<boolean>;
  log: (m: string) => void;
}

/**
 * For each theme: a 25 s audio clip (openings/endings modes), frames from the middle of the video
 * (scene mode, still) and 4 s clips (silent and with sound). Files get random names later when served.
 */
export async function processThemes(o: MediaJobOpts): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;
  for (const t of o.themes.slice(0, o.limit)) {
    const base = t.id.replace(/[^a-z0-9]+/gi, "_");
    const assets: MediaAsset[] = [];
    try {
      const audioSrc = t.audioUrl ?? t.videoUrl;
      if (audioSrc) {
        const rel = join("themes", `${base}.mp3`);
        await clipAudio({ input: audioSrc, out: join(o.mediaDir, rel), start: 0, duration: 25 });
        t.audioClip = rel;
      }
      if (t.videoUrl && t.type !== "OST") {
        const dur = await probeDuration(t.videoUrl);
        const frames = await extractFrames({ input: t.videoUrl, outDir: join(o.mediaDir, "frames"), prefix: base, count: o.framesPerVideo ?? 3, edgeSkip: 8, hasText: o.hasText, duration: dur });
        frames.forEach((f, i) => assets.push({ id: `frame:${base}:${i}`, workId: t.workId, kind: "frame", src: f.file.slice(o.mediaDir.length + 1), meta: { at: f.at, theme: t.id } }));
        const starts = clipStarts(dur, o.clipsPerVideo ?? 2, 4, 8);
        for (const [i, s] of starts.entries()) {
          const silent = join("clips", `${base}-${i}-silent.mp4`);
          const sound = join("clips", `${base}-${i}.mp4`);
          await clipVideo({ input: t.videoUrl, out: join(o.mediaDir, silent), start: s, duration: 4, mute: true });
          await clipVideo({ input: t.videoUrl, out: join(o.mediaDir, sound), start: s, duration: 4 });
          assets.push({ id: `clip_silent:${base}:${i}`, workId: t.workId, kind: "clip_silent", src: silent, meta: { theme: t.id } });
          assets.push({ id: `clip:${base}:${i}`, workId: t.workId, kind: "clip", src: sound, meta: { theme: t.id } });
        }
      }
      await o.repo.upsertThemes([t]);
      await o.repo.upsertMedia(assets);
      done++;
      o.log(`media ${t.id}: ${assets.length} files`);
    } catch (e) {
      failed++;
      o.log(`media ${t.id} failed: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  return { done, failed };
}
