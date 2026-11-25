import { gzipSync } from "node:zlib";
import { getRepo } from "@/lib/server/repo";
import { storage } from "@/lib/server/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily backup (vercel.json crons): every table, gzipped JSON, into storage `backups/backup-<date>.json.gz`.
 * Restore on a machine with the repo: download the file, then `DATABASE_URL=... pnpm restore <file>`.
 */
export async function GET(req: Request) {
  if (process.env.CRON_SECRET && req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("no", { status: 401 });
  const repo = getRepo();
  const dump = await repo.dump();
  const date = new Date().toISOString().slice(0, 10);
  const key = `backups/backup-${date}.json.gz`;
  const buf = gzipSync(JSON.stringify(dump));
  await storage().put(key, buf, "application/gzip");
  await repo.logJob("backup", "done", `${key} ${(buf.length / 1e6).toFixed(1)} MB`);
  return Response.json({ key, bytes: buf.length, tables: Object.fromEntries(Object.entries(dump).map(([k, v]) => [k, v.length])) });
}
