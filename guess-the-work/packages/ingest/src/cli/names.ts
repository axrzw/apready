/** Re-applies data/spacetoon.json (Arabic names) to the works already in the database. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT, openRepo } from "../config";
import { applySpacetoon, type SpacetoonFile } from "../pipeline/anime";

const o = await openRepo();
const file = JSON.parse(readFileSync(join(PROJECT_ROOT, "packages", "ingest", "data", "spacetoon.json"), "utf8")) as SpacetoonFile;
const lib = await o.repo.loadLibrary();
const n = applySpacetoon(lib.works, lib.characters, file);
await o.repo.upsertWorks(lib.works);
await o.repo.upsertCharacters(lib.characters);
console.log(`Arabic names applied to ${n} works`);
await o.close();
