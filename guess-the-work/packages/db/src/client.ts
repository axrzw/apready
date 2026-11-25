import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PgRepo, type DB } from "./pg";

export const MIGRATIONS_DIR = (() => {
  if (process.env.GTW_MIGRATIONS_DIR) return process.env.GTW_MIGRATIONS_DIR;
  try {
    return join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  } catch {
    return join(process.cwd(), "migrations");
  }
})();

export interface Opened {
  repo: PgRepo;
  db: DB;
  kind: "neon" | "pglite";
  migrate(): Promise<void>;
  close(): Promise<void>;
}

/**
 * DATABASE_URL (Neon / any Postgres) -> serverless HTTP driver.
 * Otherwise PGlite: a folder on disk (GTW_PGLITE_DIR) or memory (":memory:", tests). No Docker needed.
 */
export async function openDb(opts: { url?: string; pgliteDir?: string; migrationsDir?: string } = {}): Promise<Opened> {
  const migrationsFolder = opts.migrationsDir ?? MIGRATIONS_DIR;
  const url = opts.url ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (url) {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    const db = drizzle(neon(url)) as unknown as DB;
    return {
      repo: new PgRepo(db),
      db,
      kind: "neon",
      async migrate() {
        const { migrate } = await import("drizzle-orm/neon-http/migrator");
        await migrate(db as never, { migrationsFolder });
      },
      async close() {},
    };
  }
  const dir = opts.pgliteDir ?? process.env.GTW_PGLITE_DIR ?? "memory://";
  if (!dir.startsWith("memory://")) mkdirSync(dirname(dir), { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite(dir);
  const db = drizzle(client) as unknown as DB;
  return {
    repo: new PgRepo(db),
    db,
    kind: "pglite",
    async migrate() {
      const { migrate } = await import("drizzle-orm/pglite/migrator");
      await migrate(db as never, { migrationsFolder });
    },
    async close() {
      await client.close();
    },
  };
}
