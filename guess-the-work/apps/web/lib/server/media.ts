import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Asset } from "@gtw/core/questions";
import { renderEffect } from "@gtw/ingest/effects";
import { clipAudio } from "@gtw/ingest/media";
import { SESSION_SECRET } from "./env";
import { storage } from "./storage";

/**
 * Files reach the browser only through /api/m/<token>. The token is the asset description encrypted
 * (AES-256-GCM) with the server key: stateless (any serverless instance can read it), opaque (nothing about
 * the work in the URL), and deterministic for the same asset so every player gets the same URL.
 */
export interface TokenPayload {
  a: Asset | { type: "plain"; src: string };
  /** room + question: the reveal step is checked against the room's clock */
  r?: string;
  q?: string;
  /** only these users may load it (private items in describer / drawer) */
  u?: string[];
  /** expiry (ms) */
  e: number;
}

const KEY = createHash("sha256").update(`gtw-media|${SESSION_SECRET}`).digest();

export function makeToken(p: TokenPayload): string {
  const json = Buffer.from(JSON.stringify(p));
  const iv = createHmac("sha256", KEY).update(json).digest().subarray(0, 12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(json), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
}

export function readToken(t: string): TokenPayload | null {
  try {
    const b = Buffer.from(t, "base64url");
    const d = createDecipheriv("aes-256-gcm", KEY, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    const p = JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString()) as TokenPayload;
    return p.e > Date.now() ? p : null;
  } catch {
    return null;
  }
}

/** Expiry rounded to the day so the same asset keeps the same URL during a game. */
export function dayExpiry(days = 2) {
  return (Math.floor(Date.now() / 86_400_000) + days) * 86_400_000;
}

export function assetUrl(p: Omit<TokenPayload, "e"> & { e?: number }) {
  return `/api/m/${makeToken({ ...p, e: p.e ?? dayExpiry() })}`;
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/** A source: remote URL (cached in storage) or a processed file ("themes/x.mp3" -> storage media/...). */
export async function loadSource(src: string): Promise<Buffer> {
  const st = storage();
  if (/^https?:\/\//.test(src)) {
    const key = `remote/${hash(src)}`;
    const hit = await st.get(key);
    if (hit) return hit;
    const res = await fetch(src, { headers: { "user-agent": "guess-the-work/0.1" } });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await st.put(key, buf, res.headers.get("content-type") ?? "application/octet-stream");
    return buf;
  }
  const buf = await st.get(`media/${src.replace(/^\/+/, "")}`);
  if (!buf) throw new Error("missing media");
  return buf;
}

const memo = new Map<string, { buffer: Buffer; type: string }>();

export async function renderImage(a: TokenPayload["a"], step: number): Promise<{ buffer: Buffer; type: string }> {
  if (a.type === "plain") return { buffer: await loadSource(a.src), type: a.src.endsWith(".png") ? "image/png" : "image/jpeg" };
  if (a.type !== "image") throw new Error("not an image");
  const s = Math.max(0, Math.min(step, a.steps - 1));
  const key = hash(`${a.src}|${a.effect}|${s}|${a.steps}|${a.seed}|${JSON.stringify(a.mask ?? [])}`);
  const m = memo.get(key);
  if (m) return m;
  const st = storage();
  const cached = await st.get(`fx/${key}`);
  let out: { buffer: Buffer; type: string };
  if (cached) out = { buffer: cached, type: a.effect === "ascii" ? "image/png" : "image/jpeg" };
  else {
    out = await renderEffect(await loadSource(a.src), { effect: a.effect, step: s, steps: a.steps, seed: a.seed, textBoxes: a.mask });
    await st.put(`fx/${key}`, out.buffer, out.type);
  }
  if (memo.size > 300) memo.delete(memo.keys().next().value!);
  memo.set(key, out);
  return out;
}

/**
 * Audio only (strict pipeline): cut on the server, no video stream, no subtitles/data, no metadata,
 * loudness normalised, short fades; cached in storage under a random-looking key.
 */
export async function renderAudio(a: Extract<Asset, { type: "audio" }>): Promise<Buffer> {
  const key = `audio/${hash(`v2|${a.src}|${a.effect}|${a.start}|${a.duration}`)}.m4a`;
  const st = storage();
  const hit = await st.get(key);
  if (hit) return hit;
  const dir = mkdtempSync(join(tmpdir(), "gtw-a-"));
  try {
    let input = a.src;
    if (!/^https?:\/\//.test(a.src)) {
      input = join(dir, "in");
      writeFileSync(input, await loadSource(a.src));
    }
    const out = join(dir, "out.m4a");
    await clipAudio({ input, out, start: a.start, duration: a.duration, effect: a.effect });
    const buf = readFileSync(out);
    await st.put(key, buf, "audio/mp4");
    return buf;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
