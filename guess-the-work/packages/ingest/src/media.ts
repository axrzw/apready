import { execFile } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

export async function probeDuration(input: string): Promise<number> {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", input], { timeout: 60_000 });
  return Number(stdout.trim());
}

export type AudioEffect = "normal" | "fast" | "slow" | "reverse" | "first_second";

export const AUDIO_FILTERS: Record<AudioEffect, string | null> = {
  normal: null,
  fast: "atempo=1.6",
  slow: "atempo=0.6",
  reverse: "areverse",
  first_second: null,
};

export interface AudioClipOpts {
  input: string;
  out: string; // .mp3
  start: number;
  duration: number;
  effect?: AudioEffect;
}

/** Cuts an audio clip (mp3) with a fade, optionally sped up, slowed down or reversed. */
export async function clipAudio(o: AudioClipOpts): Promise<string> {
  mkdirSync(dirname(o.out), { recursive: true });
  const effect = o.effect ?? "normal";
  const duration = effect === "first_second" ? 1 : o.duration;
  const filters = [AUDIO_FILTERS[effect], `afade=t=in:d=0.15`].filter(Boolean) as string[];
  if (effect !== "first_second" && effect !== "reverse") filters.push(`afade=t=out:st=${Math.max(0, (effect === "fast" ? duration / 1.6 : effect === "slow" ? duration / 0.6 : duration) - 0.6)}:d=0.6`);
  await run(
    FFMPEG,
    ["-y", "-v", "error", "-ss", String(o.start), "-t", String(duration), "-i", o.input, "-vn", "-af", filters.join(","), "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "128k", o.out],
    { timeout: 120_000 },
  );
  return o.out;
}

export interface VideoClipOpts {
  input: string;
  out: string; // .mp4
  start: number;
  duration: number;
  mute?: boolean;
  width?: number;
}

export async function clipVideo(o: VideoClipOpts): Promise<string> {
  mkdirSync(dirname(o.out), { recursive: true });
  const args = ["-y", "-v", "error", "-ss", String(o.start), "-t", String(o.duration), "-i", o.input, "-vf", `scale=${o.width ?? 854}:-2`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
  if (o.mute) args.push("-an");
  else args.push("-c:a", "aac", "-b:a", "128k");
  args.push(o.out);
  await run(FFMPEG, args, { timeout: 180_000 });
  return o.out;
}

export async function grabFrame(input: string, at: number, out: string, width = 1280): Promise<string> {
  mkdirSync(dirname(out), { recursive: true });
  await run(FFMPEG, ["-y", "-v", "error", "-ss", String(at), "-i", input, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "3", out], { timeout: 60_000 });
  return out;
}

export interface FrameCheck {
  ok: boolean;
  reason?: "black" | "flat" | "text";
  mean: number;
  stdev: number;
}

/** Rejects black / flat frames; `hasText` (OCR) rejects frames with clear text (credits, titles). */
export async function checkFrame(file: string, hasText?: (file: string) => Promise<boolean>): Promise<FrameCheck> {
  // read into memory: sharp caches by file name and frames are rewritten under the same name
  const st = await sharp(readFileSync(file)).greyscale().stats();
  const mean = st.channels[0].mean;
  const stdev = st.channels[0].stdev;
  if (mean < 22) return { ok: false, reason: "black", mean, stdev };
  if (stdev < 12) return { ok: false, reason: "flat", mean, stdev };
  if (hasText && (await hasText(file))) return { ok: false, reason: "text", mean, stdev };
  return { ok: true, mean, stdev };
}

export interface FramesOpts {
  input: string;
  outDir: string;
  prefix: string;
  count: number;
  /** skip this many seconds at the start and end (title cards, credits) */
  edgeSkip?: number;
  hasText?: (file: string) => Promise<boolean>;
  duration?: number;
}

/** Picks `count` good frames spread over the middle of a video. */
export async function extractFrames(o: FramesOpts): Promise<{ file: string; at: number }[]> {
  const dur = o.duration ?? (await probeDuration(o.input));
  const edge = Math.min(o.edgeSkip ?? 12, dur * 0.2);
  const span = dur - 2 * edge;
  if (span <= 0) return [];
  const tries = o.count * 3;
  const out: { file: string; at: number }[] = [];
  for (let i = 0; i < tries && out.length < o.count; i++) {
    const at = edge + (span * (i + 0.5)) / tries;
    const file = join(o.outDir, `${o.prefix}-${out.length}.jpg`);
    await grabFrame(o.input, at, file);
    const c = await checkFrame(file, o.hasText);
    if (c.ok) out.push({ file, at });
  }
  return out;
}

/** Start times of 3-5 s clips inside the safe middle of a video. */
export function clipStarts(duration: number, count: number, clipLen = 4, edge = 12): number[] {
  const e = Math.min(edge, duration * 0.2);
  const span = duration - 2 * e - clipLen;
  if (span <= 0) return [];
  return Array.from({ length: count }, (_, i) => Math.round((e + (span * (i + 0.5)) / count) * 10) / 10);
}
