import "server-only";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { join, resolve } from "node:path";
import { getSession } from "./session";
import { getRepo } from "./repo";
import { DATA_DIR } from "./env";
import { invalidateLibrary } from "./library";

export async function adminApi() {
  const s = await getSession();
  if (!s) return Response.json({ error: "login" }, { status: 401 });
  const u = await getRepo().getUser(s.uid);
  if (!s.admin && !u?.isAdmin) return Response.json({ error: "admin only" }, { status: 403 });
  return s;
}

const JOBS: Record<string, { script: string; args: string[] }> = {
  weekly: { script: "src/cli/weekly.ts", args: [] },
  seed_small: { script: "src/cli/seed.ts", args: ["--anime", "600", "--kitsu", "50", "--tvmaze", "200", "--vndb", "100"] },
  seed_big: { script: "src/cli/seed.ts", args: ["--anime", "3600", "--kitsu", "150", "--tvmaze", "1000", "--vndb", "700"] },
  media: { script: "src/cli/seed.ts", args: ["--anime", "0", "--kitsu", "0", "--tvmaze", "0", "--vndb", "0", "--tmdb", "0", "--igdb", "0", "--themes", "--media", "100"] },
  ocr: { script: "src/cli/ocr.ts", args: ["--limit", "1000"] },
  keyed: { script: "src/cli/seed.ts", args: ["--anime", "0", "--kitsu", "0", "--tvmaze", "0", "--vndb", "0", "--tmdb", "1500", "--igdb", "1500"] },
};

const g = globalThis as unknown as { __gtwJobs?: Map<string, { started: number; log: string }> };
const running = (g.__gtwJobs ??= new Map());

export function jobNames() {
  return Object.keys(JOBS);
}

export function runningJobs() {
  return [...running.entries()].map(([name, v]) => ({ name, ...v }));
}

/** Runs an ingest CLI in the background (one of each at a time). */
export function runJob(name: string): string {
  const job = JOBS[name];
  if (!job) throw new Error("unknown job");
  if (running.has(name)) throw new Error("already running");
  const dir = join(DATA_DIR, "jobs");
  mkdirSync(dir, { recursive: true });
  const log = join(dir, `${name}-${Date.now()}.log`);
  const out = openSync(log, "a");
  const cwd = resolve(process.cwd(), "..", "..", "packages", "ingest");
  const tsx = resolve(cwd, "..", "..", "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsx, job.script, ...job.args], {
    cwd,
    env: { ...process.env, GTW_DATA_DIR: DATA_DIR, NODE_USE_ENV_PROXY: process.env.HTTPS_PROXY ? "1" : process.env.NODE_USE_ENV_PROXY },
    stdio: ["ignore", out, out],
    detached: false,
  });
  running.set(name, { started: Date.now(), log });
  child.on("exit", () => {
    running.delete(name);
    invalidateLibrary();
  });
  return log;
}

export function hasYtDlp(): boolean {
  try {
    return spawnSync("yt-dlp", ["--version"]).status === 0;
  } catch {
    return false;
  }
}

/** Direct media URL from a page link (YouTube...) with yt-dlp, else the URL as is. */
export function resolveMediaUrl(url: string, audioOnly: boolean): string {
  if (/\.(mp3|ogg|opus|m4a|webm|mp4|wav|flac)(\?|$)/i.test(url) || !hasYtDlp()) return url;
  const r = spawnSync("yt-dlp", ["-f", audioOnly ? "bestaudio" : "best[height<=720]/best", "-g", "--no-playlist", url], { encoding: "utf8", timeout: 60_000 });
  const first = r.stdout?.split("\n").find(Boolean);
  if (r.status !== 0 || !first) throw new Error(`yt-dlp: ${(r.stderr || "").slice(0, 200)}`);
  return first;
}
