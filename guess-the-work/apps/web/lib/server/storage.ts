import "server-only";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { DATA_DIR, MEDIA_DIR } from "./env";

/**
 * One storage layer: Vercel Blob in production (BLOB_READ_WRITE_TOKEN), a folder locally.
 * Keys are opaque paths like "cache/ab12...mp3" or "media/drawings/<id>.png". Browsers never see them:
 * files are always served through /api/m/<token>.
 */
export interface Storage {
  get(key: string): Promise<Buffer | null>;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  kind: "blob" | "local";
}

const LOCAL_ROOT = resolve(DATA_DIR, "store");

function safe(root: string, key: string) {
  const p = resolve(root, key);
  if (!p.startsWith(root + sep)) throw new Error("bad key");
  return p;
}

const local: Storage = {
  kind: "local",
  async get(key) {
    // media/<path> also falls back to the files the ingest scripts wrote into data/media
    for (const p of [safe(LOCAL_ROOT, key), ...(key.startsWith("media/") ? [safe(resolve(MEDIA_DIR), key.slice(6))] : [])]) if (existsSync(p)) return readFileSync(p);
    return null;
  },
  async put(key, data) {
    const p = safe(LOCAL_ROOT, key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
  },
};

const blob: Storage = {
  kind: "blob",
  async get(key) {
    const { head } = await import("@vercel/blob");
    try {
      const h = await head(key);
      const r = await fetch(h.url, { cache: "no-store" });
      return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
    } catch {
      return null;
    }
  },
  async put(key, data, contentType) {
    const { put } = await import("@vercel/blob");
    await put(key, data, { access: "public", contentType, addRandomSuffix: false, allowOverwrite: true });
  },
};

export function storage(): Storage {
  return process.env.BLOB_READ_WRITE_TOKEN ? blob : local;
}

export const localStoreRoot = () => join(LOCAL_ROOT);
