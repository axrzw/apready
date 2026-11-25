/**
 * OCR job: finds the text on every poster (titles!) and stores the boxes on the work (posterBoxes).
 * The site blurs those boxes before any poster effect.   pnpm ocr -- --limit 500
 */
import { join } from "node:path";
import { DATA_DIR, ensureProxyEnv, openRepo } from "../config";
import { closeOcr, textBoxes } from "../ocr";
import { num, parseArgs } from "./args";

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const o = await openRepo();
  const lib = await o.repo.loadLibrary();
  const todo = lib.works.filter((w) => w.posterUrl && !w.posterBoxes).sort((x, y) => y.popularity - x.popularity).slice(0, num(a.limit, 500));
  let done = 0;
  for (const w of todo) {
    try {
      const res = await fetch(w.posterUrl!);
      if (!res.ok) continue;
      w.posterBoxes = await textBoxes(Buffer.from(await res.arrayBuffer()), join(DATA_DIR, "tessdata"));
      await o.repo.upsertWorks([w]);
      if (++done % 25 === 0) console.log(`ocr ${done}/${todo.length}`);
    } catch (e) {
      console.log(`ocr ${w.id}: ${(e as Error).message}`);
    }
  }
  await closeOcr();
  await o.repo.logJob("ocr", "done", `${done} posters`);
  console.log(`ocr done: ${done}`);
  await o.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureProxyEnv();
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
