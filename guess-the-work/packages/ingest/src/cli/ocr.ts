/**
 * OCR job: finds the text on every poster (titles!) and saves the boxes as
 * <media>/ocr/<sha1(url)>.json. The site blurs those boxes before any poster effect.
 *   pnpm --filter @gtw/ingest ocr -- --limit 500
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SqliteRepo } from "@gtw/db";
import { DATA_DIR, DB_PATH, MEDIA_DIR, ensureProxyEnv } from "../config";
import { closeOcr, textBoxes } from "../ocr";
import { num, parseArgs } from "./args";

export const ocrFile = (mediaDir: string, src: string) => join(mediaDir, "ocr", `${createHash("sha1").update(src).digest("hex")}.json`);

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const repo = new SqliteRepo(DB_PATH);
  const lib = await repo.loadLibrary();
  mkdirSync(join(MEDIA_DIR, "ocr"), { recursive: true });
  const todo = lib.works.filter((w) => w.posterUrl && !existsSync(ocrFile(MEDIA_DIR, w.posterUrl))).sort((x, y) => y.popularity - x.popularity).slice(0, num(a.limit, 500));
  let done = 0;
  for (const w of todo) {
    try {
      const res = await fetch(w.posterUrl!);
      if (!res.ok) continue;
      const boxes = await textBoxes(Buffer.from(await res.arrayBuffer()), join(DATA_DIR, "tessdata"));
      writeFileSync(ocrFile(MEDIA_DIR, w.posterUrl!), JSON.stringify(boxes));
      done++;
      if (done % 25 === 0) console.log(`ocr ${done}/${todo.length}`);
    } catch (e) {
      console.log(`ocr ${w.id}: ${(e as Error).message}`);
    }
  }
  await closeOcr();
  await repo.logJob("ocr", "done", `${done} posters`);
  console.log(`ocr done: ${done}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  ensureProxyEnv();
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
