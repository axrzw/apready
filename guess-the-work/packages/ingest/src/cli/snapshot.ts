/**
 * Library snapshot (works, characters, people, themes, media metadata; images stay as URLs).
 *   pnpm snapshot:export   -> snapshot/library.json.gz
 *   pnpm snapshot:import   -> fills an empty (or existing) database in seconds, no API calls
 */
import { gunzipSync, gzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SqliteRepo } from "@gtw/db";
import type { Library } from "@gtw/core/library";
import { DB_PATH, PROJECT_ROOT } from "../config";

export const SNAPSHOT = join(PROJECT_ROOT, "snapshot", "library.json.gz");

export function packLibrary(lib: Library): Buffer {
  // files cut on one machine don't exist on another: keep only remote media
  const clean = {
    ...lib,
    themes: lib.themes.filter((t) => !t.id.startsWith("admin:")).map((t) => ({ ...t, audioClip: undefined })),
    media: lib.media.filter((m) => /^https?:/.test(m.src)),
  };
  return gzipSync(JSON.stringify(clean), { level: 9 });
}

export function unpackLibrary(buf: Buffer): Library {
  return JSON.parse(gunzipSync(buf).toString("utf8")) as Library;
}

async function main(cmd: string) {
  const repo = new SqliteRepo(DB_PATH);
  if (cmd === "export") {
    mkdirSync(join(PROJECT_ROOT, "snapshot"), { recursive: true });
    writeFileSync(SNAPSHOT, packLibrary(await repo.loadLibrary()));
    console.log(`wrote ${SNAPSHOT}`);
  } else {
    if (!existsSync(SNAPSHOT)) throw new Error(`no snapshot at ${SNAPSHOT}`);
    const lib = unpackLibrary(readFileSync(SNAPSHOT));
    await repo.upsertWorks(lib.works);
    await repo.upsertCharacters(lib.characters);
    await repo.upsertPeople(lib.people);
    await repo.upsertThemes(lib.themes);
    await repo.upsertMedia(lib.media);
    await repo.logJob("snapshot", "imported", JSON.stringify(await repo.counts()));
    console.log("imported", JSON.stringify(await repo.counts()));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv[2] ?? "import").catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
