import "server-only";
import { SqliteRepo, type Repo } from "@gtw/db";
import { DB_PATH } from "./env";

const g = globalThis as unknown as { __gtwRepo?: Repo };

/** The data layer. DATA_BACKEND=supabase switches to Supabase (see packages/db/src/supabase.ts). */
export function getRepo(): Repo {
  if (!g.__gtwRepo) {
    if (process.env.DATA_BACKEND === "supabase") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SupabaseRepo } = require("@gtw/db/supabase") as typeof import("@gtw/db/supabase");
      g.__gtwRepo = new SupabaseRepo(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    } else {
      g.__gtwRepo = new SqliteRepo(DB_PATH);
    }
  }
  return g.__gtwRepo;
}
