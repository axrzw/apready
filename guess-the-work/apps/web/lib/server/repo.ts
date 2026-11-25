import "server-only";
import { join, resolve } from "node:path";
import { openDb, type Repo } from "@gtw/db";
import { DATA_DIR } from "./env";

const g = globalThis as unknown as { __gtwRepo?: Repo; __gtwOpen?: Promise<Repo> };

/** On Vercel the database must be Neon (the file system is read-only and not shared). */
export const dbMissing = () => !!process.env.VERCEL && !process.env.DATABASE_URL && !process.env.POSTGRES_URL;

function open(): Promise<Repo> {
  if (dbMissing()) return Promise.reject(new Error("DATABASE_URL is missing: add Neon from the Vercel Marketplace"));
  // Neon in production (DATABASE_URL), PGlite folder locally. Migrations run at build (db:setup) and here once.
  g.__gtwOpen ??= openDb({ pgliteDir: process.env.GTW_PGLITE_DIR || join(DATA_DIR, "pglite"), migrationsDir: resolve(process.cwd(), "..", "..", "packages", "db", "migrations") }).then(async (o) => {
    if (o.kind === "pglite") await o.migrate();
    return o.repo;
  });
  return g.__gtwOpen;
}

/** The data layer. Methods are async; the connection opens on first use. */
export function getRepo(): Repo {
  g.__gtwRepo ??= new Proxy({} as Repo, {
    get: (_t, key: string) => async (...args: unknown[]) => {
      const r = await open();
      return (r as unknown as Record<string, (...a: unknown[]) => unknown>)[key](...args);
    },
  });
  return g.__gtwRepo;
}
