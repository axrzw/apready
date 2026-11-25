import type { Category, Tier, TierMix } from "./types";
import type { LibraryIndex } from "./library";
import { characterNames, workNames } from "./library";
import { candidatesFor } from "./questions";
import { selectQuestions, type Candidate } from "./select";
import type { Rng } from "./rng";
import type { AnswerRecord } from "./records";

/** Something one player sees privately (describer / drawer). */
export interface PartyItem {
  key: string;
  workId: string;
  category: Category;
  tier: Tier;
  kind: "work" | "character";
  image: string;
  /** full answer (the work, or the character) */
  names: string[];
  /** the work, when the item is a character (base points in drawer, partial in describer) */
  workNames: string[];
  /** words the describer may not say */
  forbidden: string[];
  display: { title: string; titleAr?: string; sub?: string };
}

export interface PickOptions {
  mix: TierMix;
  rng: Rng;
  seen?: Map<string, number>;
  categories?: Category[];
}

export function pickPartyItems(lib: LibraryIndex, n: number, o: PickOptions, prefix: string): PartyItem[] {
  const chars = candidatesFor("character_name", lib).filter((c) => (lib.character.get(c.key.slice("character_name:".length))?.role ?? "") === "MAIN");
  const posters = candidatesFor("poster", lib);
  const pool: Candidate[] = [...chars.map((c) => ({ ...c, key: `${prefix}:char:${c.key.slice(15)}` })), ...posters.map((c) => ({ ...c, key: `${prefix}:work:${c.key.slice(7)}` }))];
  const chosen = selectQuestions(pool, { count: n, mix: o.mix, rng: o.rng, seen: o.seen, categories: o.categories });
  return chosen.map((c) => itemFrom(lib, c)).filter((x): x is PartyItem => !!x);
}

function itemFrom(lib: LibraryIndex, c: Candidate): PartyItem | null {
  const w = lib.work.get(c.workId);
  if (!w) return null;
  const [, , kind] = c.key.split(":");
  const wn = workNames(w);
  const mainChars = (lib.charsByWork.get(w.id) ?? []).filter((x) => x.role === "MAIN").flatMap(characterNames);
  if (kind === "char") {
    const id = c.key.split(":").slice(3).join(":");
    const ch = lib.character.get(id);
    if (!ch?.imageUrl) return null;
    const cn = characterNames(ch);
    return { key: c.key, workId: w.id, category: w.category, tier: w.tier, kind: "character", image: ch.imageUrl, names: cn, workNames: wn, forbidden: [...cn, ...wn], display: { title: ch.name, titleAr: ch.nameAr, sub: w.titleAr ?? w.title } };
  }
  if (!w.posterUrl) return null;
  return { key: c.key, workId: w.id, category: w.category, tier: w.tier, kind: "work", image: w.posterUrl, names: wn, workNames: wn, forbidden: [...wn, ...mainChars], display: { title: w.title, titleAr: w.titleAr } };
}
