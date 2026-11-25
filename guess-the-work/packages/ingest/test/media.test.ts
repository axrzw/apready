import { describe, expect, it, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clipAudio, clipVideo, extractFrames, probeDuration, clipStarts } from "../src/media";

const dir = mkdtempSync(join(tmpdir(), "gtw-media-"));
const video = join(dir, "in.mp4");

beforeAll(() => {
  // 6 s black, 30 s colour bars with a tone, 6 s black
  execFileSync("ffmpeg", ["-v", "error", "-y",
    "-f", "lavfi", "-i", "color=black:s=320x240:d=6",
    "-f", "lavfi", "-i", "testsrc2=s=320x240:d=30",
    "-f", "lavfi", "-i", "color=black:s=320x240:d=6",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=42",
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a", "-c:v", "libx264", "-c:a", "aac", "-shortest", video]);
}, 60_000);

describe("media", () => {
  it("probes duration", async () => {
    expect(Math.round(await probeDuration(video))).toBe(42);
  });
  it("cuts audio clips with effects", async () => {
    for (const effect of ["normal", "fast", "slow", "reverse", "first_second"] as const) {
      const out = await clipAudio({ input: video, out: join(dir, `a-${effect}.m4a`), start: 10, duration: 8, effect });
      expect(existsSync(out)).toBe(true);
      const d = await probeDuration(out);
      if (effect === "first_second") expect(d).toBeLessThan(1.3);
      if (effect === "fast") expect(d).toBeLessThan(6);
      if (effect === "slow") expect(d).toBeGreaterThan(11);
    }
  }, 60_000);
  it("extracts frames and skips black ones", async () => {
    const frames = await extractFrames({ input: video, outDir: dir, prefix: "f", count: 4, edgeSkip: 1 });
    expect(frames.length).toBe(4);
    for (const f of frames) expect(f.at >= 6 && f.at <= 36).toBe(true);
  }, 60_000);
  it("cuts silent and sound clips", async () => {
    const silent = await clipVideo({ input: video, out: join(dir, "s.mp4"), start: 10, duration: 4, mute: true, width: 320 });
    expect(Math.round(await probeDuration(silent))).toBe(4);
  }, 60_000);
  it("plans clip starts away from the edges", () => {
    const s = clipStarts(90, 3, 4, 12);
    expect(s.length).toBe(3);
    expect(Math.min(...s)).toBeGreaterThanOrEqual(12);
    expect(Math.max(...s) + 4).toBeLessThanOrEqual(78);
  });
});
