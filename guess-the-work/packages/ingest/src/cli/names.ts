/** Re-applies data/spacetoon.json (Arabic names) to the works already in the database. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SqliteRepo } from "@gtw/db";
import { DB_PATH, PROJECT_ROOT } from "../config";
import { applySpacetoon, type SpacetoonFile } from "../pipeline/anime";

const repo = new SqliteRepo(DB_PATH);
const file = JSON.parse(readFileSync(join(PROJECT_ROOT, "packages", "ingest", "data", "spacetoon.json"), "utf8")) as SpacetoonFile;
const lib = await repo.loadLibrary();
const n = applySpacetoon(lib.works, lib.characters, file);
await repo.upsertWorks(lib.works);
await repo.upsertCharacters(lib.characters);
console.log(`Arabic names applied to ${n} works`);
