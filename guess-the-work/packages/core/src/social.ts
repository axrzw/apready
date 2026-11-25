import type { LibraryIndex } from "./library";
import type { Question } from "./questions";
import { randomId, shuffle, type Rng } from "./rng";

/** Social modes (party, not in Mix): about the group's own watch log. */
export type SocialMode = "who_watched" | "guess_rating";
export interface LogRow {
  userId: string;
  workId: string;
  status: string;
  rating?: number;
}

const watched = (s: string) => s === "seen" || s === "watching" || s === "dropped";

export function buildSocialQuestions(lib: LibraryIndex, o: { modes: SocialMode[]; count: number; players: { id: string; name: string }[]; log: LogRow[]; rng: Rng }): Question[] {
  const ids = new Set(o.players.map((p) => p.id));
  const name = (id: string) => o.players.find((p) => p.id === id)?.name ?? "؟";
  const out: Question[] = [];
  const pool: (() => Question | null)[] = [];

  if (o.modes.includes("who_watched")) {
    const byWork = new Map<string, string[]>();
    for (const r of o.log) if (ids.has(r.userId) && watched(r.status)) byWork.set(r.workId, [...(byWork.get(r.workId) ?? []), r.userId]);
    for (const [workId, seen] of byWork) {
      const w = lib.work.get(workId);
      // somebody must be left to answer
      if (!w || seen.length >= o.players.length) continue;
      pool.push(() => {
        const choices = shuffle(o.players, o.rng).map((p) => ({ id: randomId(o.rng, 8), label: p.name, pid: p.id }));
        return {
          id: randomId(o.rng),
          key: `who_watched:${workId}`,
          mode: "who_watched" as never,
          workId,
          category: w.category,
          tier: w.tier,
          promptAr: "مين من الغرفة شاف هذا العمل؟ (اختر أكثر من واحد)",
          promptEn: "Who in this room has seen it? (pick several)",
          assets: w.posterUrl ? [{ type: "image", src: w.posterUrl, effect: "none", steps: 1, seed: 0 }] : [],
          items: [{ label: w.title, labelAr: w.titleAr }],
          answerType: "multi",
          names: [],
          choices: choices.map(({ id, label }) => ({ id, label })),
          correctPicks: choices.filter((c) => seen.includes(c.pid)).map((c) => c.id),
          excluded: seen,
          display: { title: seen.map(name).join("، "), sub: w.titleAr ?? w.title, image: w.posterUrl },
          hints: [],
          timeLimitMs: 25_000,
        };
      });
    }
  }
  if (o.modes.includes("guess_rating")) {
    for (const r of o.log) {
      const w = lib.work.get(r.workId);
      if (!w || !ids.has(r.userId) || !r.rating) continue;
      pool.push(() => ({
        id: randomId(o.rng),
        key: `guess_rating:${r.userId}:${r.workId}`,
        mode: "guess_rating" as never,
        workId: r.workId,
        category: w.category,
        tier: w.tier,
        promptAr: `كم أعطاه ${name(r.userId)} من 10؟`,
        promptEn: `How did ${name(r.userId)} rate it out of 10?`,
        assets: w.posterUrl ? [{ type: "image", src: w.posterUrl, effect: "none", steps: 1, seed: 0 }] : [],
        items: [{ label: w.title, labelAr: w.titleAr }],
        answerType: "number",
        names: [],
        correctNumber: r.rating,
        excluded: [r.userId],
        display: { title: `${r.rating}/10`, sub: `${name(r.userId)} · ${w.titleAr ?? w.title}`, image: w.posterUrl },
        hints: [],
        timeLimitMs: 20_000,
      }));
    }
  }
  for (const make of shuffle(pool, o.rng)) {
    if (out.length >= o.count) break;
    const q = make();
    if (q) out.push(q);
  }
  return out;
}
