import type { Category, ModeId, TierMix } from "./types";
import type { LibraryIndex } from "./library";
import type { ImageEffectId } from "./effects";
import { buildQuestion, candidatesFor, MODES, type Question } from "./questions";
import { selectQuestions } from "./select";
import type { Rng } from "./rng";

export const GUESS_MODES: ModeId[] = MODES.map((m) => m.id);

export interface GenerateOptions {
  modes: ModeId[]; // one mode, or several for Mix
  count: number;
  mix: TierMix;
  rng: Rng;
  categories?: Category[];
  seen?: Map<string, number>;
  repeatAfterDays?: number;
  effects?: ImageEffectId[];
  sceneLevel?: 1 | 2 | 3;
  timeLimitMs?: number;
  now?: number;
}

/** Modes that have material in this library (and in these categories). */
export function availableModes(lib: LibraryIndex, categories?: Category[]): ModeId[] {
  return GUESS_MODES.filter((m) => candidatesFor(m, lib).some((c) => !categories?.length || categories.includes(c.category)));
}

/**
 * Picks the questions of a game. With several modes (Mix) each question gets a random mode,
 * then every mode selects its share with the tier mix and the no-repeat rule.
 */
export function generateQuestions(lib: LibraryIndex, o: GenerateOptions): Question[] {
  const modes = o.modes.filter((m) => GUESS_MODES.includes(m));
  if (!modes.length) return [];
  const usable = modes.filter((m) => candidatesFor(m, lib).some((c) => !o.categories?.length || o.categories.includes(c.category)));
  if (!usable.length) return [];
  const share = new Map<ModeId, number>(usable.map((m) => [m, 0]));
  for (let i = 0; i < o.count; i++) {
    const m = usable[Math.floor(o.rng() * usable.length)];
    share.set(m, share.get(m)! + 1);
  }
  const out: Question[] = [];
  const usedWorks = new Set<string>();
  for (const [mode, n] of share) {
    if (!n) continue;
    const pool = candidatesFor(mode, lib).filter((c) => !usedWorks.has(c.workId));
    const chosen = selectQuestions(pool, { count: n + 3, mix: o.mix, rng: o.rng, seen: o.seen, now: o.now, repeatAfterDays: o.repeatAfterDays, categories: o.categories });
    let made = 0;
    for (const c of chosen) {
      if (made >= n) break;
      const q = buildQuestion(mode, c, lib, { rng: o.rng, effects: o.effects, sceneLevel: o.sceneLevel, timeLimitMs: o.timeLimitMs });
      if (!q) continue;
      usedWorks.add(c.workId);
      out.push(q);
      made++;
    }
  }
  // shuffle so Mix alternates modes
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(o.rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
