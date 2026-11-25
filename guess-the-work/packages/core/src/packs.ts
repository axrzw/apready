import type { ModeId } from "./types";
import type { LibraryIndex } from "./library";
import { buildQuestion, candidatesFor, type Question } from "./questions";
import { shuffle, type Rng } from "./rng";

/** «باقتي»: a player's own set of questions (works + modes + difficulty). */
export interface PackData {
  items: { workId: string; mode: ModeId }[];
  difficulty: "easy" | "normal" | "hard";
}

const TIME: Record<PackData["difficulty"], number> = { easy: 40_000, normal: 30_000, hard: 15_000 };

export function buildPackQuestions(lib: LibraryIndex, pack: PackData, rng: Rng): Question[] {
  const out: Question[] = [];
  for (const it of shuffle(pack.items, rng)) {
    const cands = candidatesFor(it.mode, lib).filter((c) => c.workId === it.workId);
    if (!cands.length) continue;
    const q = buildQuestion(it.mode, cands[Math.floor(rng() * cands.length)], lib, { rng, timeLimitMs: TIME[pack.difficulty], effects: pack.difficulty === "easy" ? ["blur", "pixelate", "tiles"] : undefined });
    if (q) out.push(q);
  }
  return out;
}

/** Modes a work can be asked in (for the pack builder). */
export function modesForWork(lib: LibraryIndex, workId: string, modes: ModeId[]): ModeId[] {
  return modes.filter((m) => candidatesFor(m, lib).some((c) => c.workId === workId));
}
