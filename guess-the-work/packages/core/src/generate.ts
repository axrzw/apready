import type { Category, ModeId, TierMix } from "./types";
import type { LibraryIndex } from "./library";
import type { ImageEffectId } from "./effects";
import { buildQuestion, candidatesFor, MODES, type Question } from "./questions";
import { selectQuestions } from "./select";
import type { Rng } from "./rng";
import { groupFilter, groupTier, spoilerSafe, type GroupMix, type QuestionSource, type WatchMap } from "./group";

export const GUESS_MODES: ModeId[] = MODES.map((m) => m.id);

export interface GenerateOptions {
  modes: ModeId[]; // one mode, or several for Mix
  count: number;
  mix: TierMix;
  rng: Rng;
  categories?: string[];
  seen?: Map<string, number>;
  repeatAfterDays?: number;
  effects?: ImageEffectId[];
  sceneLevel?: 1 | 2 | 3;
  timeLimitMs?: number;
  now?: number;
  /** [from, to] release years */
  years?: [number | undefined, number | undefined];
  group?: {
    watch: WatchMap;
    roomPlayers: string[];
    /** everybody who logs (for group tiers) */
    groupPlayers: string[];
    source: QuestionSource;
    excludeOwnOnly: boolean;
    noSpoilers: boolean;
    mix?: GroupMix;
    weight?: number;
  };
}

/** Candidate passes the room's filters (years, question source, own-only, spoilers). */
function allowed(lib: LibraryIndex, o: GenerateOptions, key: string, workId: string): boolean {
  const w = lib.work.get(workId);
  if (o.years && w) {
    const [a, b] = o.years;
    if ((a && (!w.year || w.year < a)) || (b && (!w.year || w.year > b))) return false;
  }
  const g = o.group;
  if (!g || workId.startsWith("link:")) return true;
  if (!groupFilter(workId, g.watch, g.roomPlayers, g)) return false;
  if (g.noSpoilers) {
    const mediaId = key.split(":").slice(1).join(":");
    const m = lib.mediaById.get(mediaId);
    const position = typeof m?.meta?.position === "number" ? (m.meta.position as number) : undefined;
    const theme = lib.theme.get(mediaId);
    const lastEnding = !!theme && theme.type === "ED" && (lib.themesByWork.get(workId) ?? []).filter((t) => t.type === "ED").every((t) => (t.seq ?? 1) <= (theme.seq ?? 1)) && (lib.themesByWork.get(workId) ?? []).filter((t) => t.type === "ED").length > 1;
    if (!spoilerSafe({ workId, position, lastEnding }, g.watch, g.roomPlayers)) return false;
  }
  return true;
}

/** Modes that have material in this library (and in these categories). */
export function availableModes(lib: LibraryIndex, categories?: string[]): ModeId[] {
  return GUESS_MODES.filter((m) => candidatesFor(m, lib).some((c) => !categories?.length || categories.includes(c.section ?? c.category)));
}

/**
 * Picks the questions of a game. With several modes (Mix) each question gets a random mode,
 * then every mode selects its share with the tier mix and the no-repeat rule.
 */
export function generateQuestions(lib: LibraryIndex, o: GenerateOptions): Question[] {
  const modes = o.modes.filter((m) => GUESS_MODES.includes(m));
  if (!modes.length) return [];
  const usable = modes.filter((m) => candidatesFor(m, lib).some((c) => !o.categories?.length || o.categories.includes(c.section ?? c.category) || o.categories.includes(c.category)));
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
    const g = o.group;
    const pool = candidatesFor(mode, lib)
      .filter((c) => !usedWorks.has(c.workId) && allowed(lib, o, c.key, c.workId))
      .map((c) => (g ? { ...c, groupTier: groupTier(g.watch.get(c.workId), g.groupPlayers) } : c));
    const chosen = selectQuestions(pool, { count: n + 3, mix: o.mix, rng: o.rng, seen: o.seen, now: o.now, repeatAfterDays: o.repeatAfterDays, categories: o.categories, groupMix: g?.mix, groupWeight: g?.weight });
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
