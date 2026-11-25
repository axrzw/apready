import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clipAudio, clipVideo, probe } from "../src/media";

/** SPEC 3 "audio pipeline": audio files only, no video/subtitle/data streams, no metadata, exact length. */
const dir = mkdtempSync(join(tmpdir(), "gtw-ap-"));
const src = join(dir, "source.mkv");

beforeAll(() => {
  // a "leaky" source: video + audio + subtitles + title/artist/album/comment + chapters
  const subs = join(dir, "s.srt");
  writeFileSync(subs, "1\n00:00:01,000 --> 00:00:05,000\nAttack on Titan\n");
  const meta = join(dir, "meta.txt");
  writeFileSync(meta, ";FFMETADATA1\ntitle=Attack on Titan OP1\nartist=Linked Horizon\nalbum=Shingeki no Kyojin\ncomment=secret\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=20000\ntitle=Opening\n");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x240:d=40", "-f", "lavfi", "-i", "sine=frequency=500:duration=40", "-i", subs, "-i", meta,
    "-map", "0:v", "-map", "1:a", "-map", "2:s", "-map_metadata", "3", "-map_chapters", "3", "-c:v", "libx264", "-c:a", "aac", "-c:s", "srt", src]);
}, 60_000);

const BANNED_TAGS = ["title", "artist", "album", "comment", "album_artist", "composer", "genre", "encoder", "description", "synopsis", "show"];

async function check(file: string, wantDuration: number) {
  const p = await probe(file);
  expect(p.streams.filter((s) => s.codec_type === "video")).toEqual([]);
  expect(p.streams.filter((s) => s.codec_type === "subtitle" || s.codec_type === "data")).toEqual([]);
  expect(p.streams.filter((s) => s.codec_type === "audio").length).toBe(1);
  expect(p.chapters).toEqual([]);
  const tags = { ...p.format.tags, ...Object.assign({}, ...p.streams.map((s) => s.tags ?? {})) };
  for (const k of Object.keys(tags)) expect(BANNED_TAGS, `tag ${k}`).not.toContain(k.toLowerCase());
  expect(JSON.stringify(p)).not.toMatch(/titan|horizon|kyojin|secret/i);
  expect(Math.abs(Number(p.format.duration) - wantDuration)).toBeLessThan(0.35);
}

describe("audio pipeline", () => {
  for (const [effect, want] of [["normal", 12], ["fast", 12 / 1.6], ["slow", 12 / 0.6], ["reverse", 12], ["first_second", 1]] as const) {
    it(`${effect}: audio only, clean, ${want.toFixed(1)} s`, async () => {
      const out = join(dir, `${effect}.m4a`);
      await clipAudio({ input: src, out, start: 6, duration: 12, effect });
      await check(out, want);
    }, 60_000);
  }
  it("silent scene clips carry no audio, subtitles or metadata", async () => {
    const out = join(dir, "silent.mp4");
    await clipVideo({ input: src, out, start: 4, duration: 4, mute: true, width: 320 });
    const p = await probe(out);
    expect(p.streams.map((s) => s.codec_type)).toEqual(["video"]);
    expect(JSON.stringify(p)).not.toMatch(/titan|horizon|kyojin|secret/i);
    expect(p.chapters).toEqual([]);
  }, 60_000);
});
