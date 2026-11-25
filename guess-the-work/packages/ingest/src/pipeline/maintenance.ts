import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Repo } from "@gtw/db";
import type { Work } from "@gtw/core/types";
import { shuffle } from "@gtw/core/rng";

export type LinkCheck = (url: string) => Promise<boolean>;

export const headCheck: LinkCheck = async (url) => {
  try {
    const r = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (r.status === 405) return (await fetch(url, { method: "GET", headers: { range: "bytes=0-0" } })).ok;
    return r.ok;
  } catch {
    return false;
  }
};

/**
 * Checks a sample of remote images and every local media file.
 * Dead posters are removed from the work (the poster mode skips it); missing local files are deleted from the db.
 */
export async function checkDeadLinks(o: { repo: Repo; mediaDir: string; sample: number; check?: LinkCheck; rng: () => number; log: (m: string) => void }) {
  const lib = await o.repo.loadLibrary();
  const check = o.check ?? headCheck;
  let deadPosters = 0;
  let deadMedia = 0;
  const fixed: Work[] = [];
  for (const w of shuffle(lib.works.filter((x) => x.posterUrl), o.rng).slice(0, o.sample)) {
    if (!(await check(w.posterUrl!))) {
      deadPosters++;
      fixed.push({ ...w, posterUrl: undefined });
      o.log(`dead poster: ${w.id} ${w.posterUrl}`);
    }
  }
  if (fixed.length) await o.repo.upsertWorks(fixed);
  for (const m of lib.media) {
    if (/^https?:/.test(m.src)) continue;
    if (!existsSync(join(o.mediaDir, m.src))) {
      deadMedia++;
      await o.repo.deleteMedia(m.id);
    }
  }
  return { checked: Math.min(o.sample, lib.works.length), deadPosters, deadMedia };
}
