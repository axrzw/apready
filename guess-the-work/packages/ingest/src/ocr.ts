import type { Box } from "./effects";

/**
 * Text boxes on an image (titles on posters) with tesseract.js, English + Japanese.
 * Language data is downloaded once by tesseract.js (cached in the data dir).
 */
let worker: Promise<import("tesseract.js").Worker> | null = null;

export async function getWorker(cachePath: string) {
  if (!worker) {
    worker = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker(["eng"], 1, { cachePath, logger: () => {} });
    })();
  }
  return worker;
}

export async function textBoxes(image: Buffer, cachePath: string, minConfidence = 55): Promise<Box[]> {
  const w = await getWorker(cachePath);
  const { data } = await w.recognize(image, {}, { blocks: true });
  const boxes: Box[] = [];
  for (const b of data.blocks ?? [])
    for (const p of b.paragraphs)
      for (const l of p.lines)
        for (const word of l.words) {
          const t = word.text.replace(/[^\p{L}\p{N}]/gu, "");
          if (t.length < 2 || word.confidence < minConfidence) continue;
          const { x0, y0, x1, y1 } = word.bbox;
          boxes.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        }
  return boxes;
}

export async function closeOcr() {
  if (worker) await (await worker).terminate();
  worker = null;
}
