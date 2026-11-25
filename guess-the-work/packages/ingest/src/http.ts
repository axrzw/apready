import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpOptions {
  /** minimum ms between two requests to the same host */
  minIntervalMs?: Record<string, number>;
  cacheDir?: string;
  /** cache lifetime in ms (default 7 days) */
  ttlMs?: number;
  retries?: number;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
  log?: (msg: string) => void;
}

export const DEFAULT_INTERVALS: Record<string, number> = {
  "graphql.anilist.co": 2100, // 30 requests / minute while AniList is degraded (90 normally)
  "api.jikan.moe": 1100, // 3 / second, 60 / minute
  "kitsu.io": 300,
  "api.animethemes.moe": 1100, // 60 / minute
  "query.wikidata.org": 1500,
  "api.themoviedb.org": 100, // ~50 / second allowed
  "api.igdb.com": 300, // 4 / second
  "api.tvmaze.com": 550, // 20 / 10 seconds
  "api.vndb.org": 1100, // 200 / 5 minutes
};

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** HTTP client with a per-host rate limit, a disk cache and retries (429 / 5xx / network). */
export class Http {
  private last = new Map<string, number>();
  private queue = new Map<string, Promise<void>>();
  constructor(private o: HttpOptions = {}) {}

  private async throttle(host: string) {
    const gap = this.o.minIntervalMs?.[host] ?? DEFAULT_INTERVALS[host] ?? 250;
    const prev = this.queue.get(host) ?? Promise.resolve();
    const mine = prev.then(async () => {
      const wait = (this.last.get(host) ?? 0) + gap - Date.now();
      if (wait > 0) await (this.o.sleep ?? realSleep)(wait);
      this.last.set(host, Date.now());
    });
    this.queue.set(host, mine.catch(() => undefined));
    return mine;
  }

  private cachePath(key: string) {
    if (!this.o.cacheDir) return null;
    mkdirSync(this.o.cacheDir, { recursive: true });
    return join(this.o.cacheDir, createHash("sha1").update(key).digest("hex") + ".json");
  }

  async json<T = unknown>(url: string, init: RequestInit & { cacheKey?: string; noCache?: boolean } = {}): Promise<T> {
    const key = init.cacheKey ?? `${init.method ?? "GET"} ${url} ${typeof init.body === "string" ? init.body : ""}`;
    const cp = init.noCache ? null : this.cachePath(key);
    if (cp && existsSync(cp) && Date.now() - statSync(cp).mtimeMs < (this.o.ttlMs ?? 7 * 86_400_000)) {
      return JSON.parse(readFileSync(cp, "utf8")) as T;
    }
    const host = new URL(url).host;
    const f = this.o.fetch ?? (globalThis.fetch as FetchLike);
    const retries = this.o.retries ?? 5;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await this.throttle(host);
      try {
        const headers = new Headers(init.headers);
        if (!headers.has("user-agent")) headers.set("user-agent", this.o.userAgent ?? "guess-the-work/0.1 (private friends game)");
        if (!headers.has("accept")) headers.set("accept", "application/json");
        const res = await f(url, { ...init, headers });
        if (res.status === 429 || res.status >= 500) {
          const ra = Number(res.headers.get("retry-after"));
          const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(60_000, 1000 * 2 ** attempt);
          this.o.log?.(`${host} ${res.status}, retry in ${wait} ms`);
          lastErr = new Error(`${res.status} ${url}`);
          await (this.o.sleep ?? realSleep)(wait);
          continue;
        }
        if (!res.ok) throw Object.assign(new Error(`${res.status} ${url}: ${(await res.text()).slice(0, 200)}`), { status: res.status, fatal: true });
        const data = (await res.json()) as T;
        if (cp) writeFileSync(cp, JSON.stringify(data));
        return data;
      } catch (e) {
        if ((e as { fatal?: boolean }).fatal) throw e;
        lastErr = e;
        await (this.o.sleep ?? realSleep)(Math.min(30_000, 500 * 2 ** attempt));
      }
    }
    throw lastErr;
  }
}
