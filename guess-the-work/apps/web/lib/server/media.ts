import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { Asset } from "@gtw/core/questions";
import { renderEffect, type Box } from "@gtw/ingest/effects";
import { clipAudio } from "@gtw/ingest/media";
import { MEDIA_DIR } from "./env";

/**
 * Files reach the browser only through random tokens: /api/m/<token>.
 * The token maps to the real source on the server; effects are rendered here.
 */
export interface TokenEntry {
  asset: Asset | { type: "plain"; src: string };
  /** highest reveal step the viewer may get right now */
  allowedStep?: () => number;
  /** only these users may load it (private items in describer/drawer) */
  users?: string[];
  expires: number;
}

const g = globalThis as unknown as { __gtwTokens?: Map<string, TokenEntry>; __gtwRender?: Map<string, { buffer: Buffer; type: string }> };
const tokens = (g.__gtwTokens ??= new Map());
const renderCache = (g.__gtwRender ??= new Map());

export function registerToken(e: Omit<TokenEntry, "expires">, ttlMs = 3 * 3600_000): string {
  if (tokens.size > 20_000) {
    const now = Date.now();
    for (const [k, v] of tokens) if (v.expires < now) tokens.delete(k);
  }
  const t = randomBytes(18).toString("base64url");
  tokens.set(t, { ...e, expires: Date.now() + ttlMs });
  return t;
}

export function getToken(t: string): TokenEntry | undefined {
  const e = tokens.get(t);
  if (!e || e.expires < Date.now()) return undefined;
  return e;
}

export function assetUrl(e: Omit<TokenEntry, "expires">) {
  return `/api/m/${registerToken(e)}`;
}

function hash(s: string) {
  return createHash("sha1").update(s).digest("hex");
}

/** Local media path (inside MEDIA_DIR only) or a downloaded copy of a remote URL. */
export async function loadSource(src: string): Promise<Buffer> {
  if (/^https?:\/\//.test(src)) {
    const dir = join(MEDIA_DIR, "remote");
    const file = join(dir, hash(src));
    if (existsSync(file)) return readFileSync(file);
    const res = await fetch(src, { headers: { "user-agent": "guess-the-work/0.1" } });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, buf);
    return buf;
  }
  return readFileSync(localPath(src));
}

export function localPath(src: string): string {
  const root = resolve(MEDIA_DIR);
  const p = resolve(root, src);
  if (!p.startsWith(root + sep)) throw new Error("bad path");
  return p;
}

function textBoxes(src: string): Box[] {
  const f = join(MEDIA_DIR, "ocr", `${hash(src)}.json`);
  if (!existsSync(f)) return [];
  try {
    return JSON.parse(readFileSync(f, "utf8")) as Box[];
  } catch {
    return [];
  }
}

export async function renderImage(e: TokenEntry, requestedStep: number): Promise<{ buffer: Buffer; type: string }> {
  const a = e.asset;
  if (a.type === "plain") {
    const buf = await loadSource(a.src);
    return { buffer: buf, type: "image/jpeg" };
  }
  if (a.type !== "image") throw new Error("not an image");
  const allowed = e.allowedStep ? e.allowedStep() : a.steps - 1;
  const step = Math.max(0, Math.min(requestedStep, allowed, a.steps - 1));
  const key = `${a.src}|${a.effect}|${step}|${a.steps}|${a.seed}`;
  const hit = renderCache.get(key);
  if (hit) return hit;
  const input = await loadSource(a.src);
  const out = await renderEffect(input, { effect: a.effect, step, steps: a.steps, seed: a.seed, textBoxes: textBoxes(a.src) });
  if (renderCache.size > 400) renderCache.delete(renderCache.keys().next().value!);
  renderCache.set(key, out);
  return out;
}

/** Audio with its effect (sped up, slowed, reversed, first second), cached as mp3. */
export async function renderAudio(a: Extract<Asset, { type: "audio" }>): Promise<string> {
  const input = /^https?:\/\//.test(a.src) ? a.src : localPath(a.src);
  if (a.effect === "normal" && !/^https?:\/\//.test(a.src) && a.src.endsWith(".mp3") && a.start === 0) return input;
  const out = join(MEDIA_DIR, "cache", `${hash(`${a.src}|${a.effect}|${a.start}|${a.duration}`)}.mp3`);
  if (!existsSync(out)) await clipAudio({ input, out, start: a.start, duration: a.duration, effect: a.effect });
  return out;
}
