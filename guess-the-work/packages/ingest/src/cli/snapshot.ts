/**
 * Library snapshot (works, characters, people, themes, media metadata; images stay as URLs).
 *   pnpm snapshot:export   -> snapshot/library.json.gz
 *   pnpm snapshot:import   -> idempotent upsert, safe to run on every build
 */
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Library } from "@gtw/core/library";
import type { Repo } from "@gtw/db";
import { PROJECT_ROOT, openRepo } from "../config";

export const SNAPSHOT = join(PROJECT_ROOT, "snapshot", "library.json.gz");

export function packLibrary(lib: Library): Buffer {
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

/** Imports the snapshot unless this exact file was imported before (hash in settings). */
export async function importSnapshot(repo: Repo, file = SNAPSHOT, force = false): Promise<string> {
  if (!existsSync(file)) return "no snapshot";
  const buf = readFileSync(file);
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
  if (!force && (await repo.getSetting<string>("snapshotHash")) === hash) return `snapshot ${hash} already imported`;
  const lib = unpackLibrary(buf);
  await repo.upsertWorks(lib.works);
  await repo.upsertCharacters(lib.characters);
  await repo.upsertPeople(lib.people);
  await repo.upsertThemes(lib.themes);
  await repo.upsertMedia(lib.media);
  await repo.setSetting("snapshotHash", hash);
  await repo.logJob("snapshot", "imported", JSON.stringify(await repo.counts()));
  return `imported ${hash}: ${JSON.stringify(await repo.counts())}`;
}

async function main(cmd: string) {
  const o = await openRepo();
  if (cmd === "export") {
    mkdirSync(join(PROJECT_ROOT, "snapshot"), { recursive: true });
    writeFileSync(SNAPSHOT, packLibrary(await o.repo.loadLibrary()));
    console.log(`wrote ${SNAPSHOT}`);
  } else console.log(await importSnapshot(o.repo, SNAPSHOT, process.argv.includes("--force")));
  await o.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv[2] ?? "import").catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
