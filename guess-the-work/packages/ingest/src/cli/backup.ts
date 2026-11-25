/**
 * Backup / restore of the whole database.
 *   pnpm backup            -> data/backups/backup-<date>.json.gz
 *   pnpm restore <file>    -> into the current DATABASE_URL / PGlite (rows that exist are kept)
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, openRepo } from "../config";

async function main() {
  const [cmd, file] = process.argv.slice(2);
  const o = await openRepo();
  if (cmd === "restore") {
    if (!file) throw new Error("usage: restore <file.json.gz>");
    await o.repo.restore(JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")));
    console.log("restored", JSON.stringify(await o.repo.counts()));
  } else {
    const dir = join(DATA_DIR, "backups");
    mkdirSync(dir, { recursive: true });
    const out = join(dir, `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json.gz`);
    writeFileSync(out, gzipSync(JSON.stringify(await o.repo.dump())));
    console.log(`backup written: ${out}`);
  }
  await o.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
