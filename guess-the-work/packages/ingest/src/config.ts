import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const DATA_DIR = process.env.GTW_DATA_DIR || join(PROJECT_ROOT, "data");
export const DB_PATH = process.env.GTW_DB_PATH || join(DATA_DIR, "gtw.sqlite");
export const MEDIA_DIR = process.env.GTW_MEDIA_DIR || join(DATA_DIR, "media");
export const CACHE_DIR = join(DATA_DIR, "cache");

/** Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 is set at start-up: restart once with it. */
export function ensureProxyEnv() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy || process.env.NODE_USE_ENV_PROXY) return;
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1", NODE_NO_WARNINGS: "1" },
  });
  process.exit(r.status ?? 1);
}
