import type { Work } from "./types";
import { CATEGORY_AR, CATEGORY_EN, SEASON_AR, genreAr } from "./i18n";
import { leaksAnswer, normalize, redactNames } from "./match";

export type HintKind = "format" | "year" | "genres" | "tags" | "studio" | "stats" | "voice" | "letters";

export interface Hint {
  level: number; // 1 = most general
  kind: HintKind;
  ar: string;
  en: string;
  /** fraction of the points it costs */
  cost: number;
}

export const HINT_COST: Record<HintKind, number> = {
  format: 0.04, year: 0.06, genres: 0.07, tags: 0.08, studio: 0.1, stats: 0.1, voice: 0.15, letters: 0.2,
};

const ORDER: HintKind[] = ["format", "year", "genres", "tags", "studio", "stats", "voice", "letters"];

export interface HintContext {
  /** names the player may type: hints must never show them */
  acceptedNames: string[];
  /** the name whose letters hint 8 describes (default: work title) */
  answerName?: string;
  mainVoiceActor?: { name: string; nameAr?: string };
  /** for character questions the answer is a character, not the work */
  subject?: "work" | "character";
}

/** Builds hints from general to precise. Any hint that would show an accepted name is cleaned or dropped. */
export function buildHints(w: Work, ctx: HintContext): Hint[] {
  const raw: Partial<Record<HintKind, { ar: string; en: string } | null>> = {};
  raw.format = { ar: `${CATEGORY_AR[w.category]}${w.format ? ` · ${w.format}` : ""}`, en: `${CATEGORY_EN[w.category]}${w.format ? ` · ${w.format}` : ""}` };
  if (w.year)
    raw.year = {
      ar: w.season ? `${SEASON_AR[w.season] ?? w.season} ${w.year}` : `سنة ${w.year}`,
      en: w.season ? `${w.season.toLowerCase()} ${w.year}` : `${w.year}`,
    };
  if (w.genres.length) raw.genres = { ar: w.genres.slice(0, 4).map(genreAr).join("، "), en: w.genres.slice(0, 4).join(", ") };
  if (w.tags.length) raw.tags = { ar: w.tags.slice(0, 5).join("، "), en: w.tags.slice(0, 5).join(", ") };
  if (w.studios.length) {
    const label = w.category === "game" ? ["المطوّر", "Developer"] : w.category === "movie" ? ["المخرج/الشركة", "Director/Studio"] : ["الاستوديو", "Studio"];
    raw.studio = { ar: `${label[0]}: ${w.studios.slice(0, 2).join("، ")}`, en: `${label[1]}: ${w.studios.slice(0, 2).join(", ")}` };
  }
  const stats: string[][] = [];
  if (w.score) stats.push([`التقييم ${w.score}/100`, `score ${w.score}/100`]);
  if (w.episodes) stats.push([`${w.episodes} حلقة`, `${w.episodes} episodes`]);
  if (w.durationHours) stats.push([`${w.durationHours} ساعة لعب`, `${w.durationHours} h to beat`]);
  if (stats.length) raw.stats = { ar: stats.map((s) => s[0]).join(" · "), en: stats.map((s) => s[1]).join(" · ") };
  if (ctx.mainVoiceActor) raw.voice = { ar: `مؤدي صوت البطل: ${ctx.mainVoiceActor.nameAr ?? ctx.mainVoiceActor.name}`, en: `Lead voice: ${ctx.mainVoiceActor.name}` };
  const name = ctx.answerName ?? w.titleAr ?? w.title;
  raw.letters = { ar: letterHint(name, "ar"), en: letterHint(ctx.answerName ?? w.title, "en") };

  const out: Hint[] = [];
  for (const kind of ORDER) {
    const h = raw[kind];
    if (!h) continue;
    if (kind !== "letters") {
      // never reveal a name the player could type
      const ar = leaksAnswer(h.ar, ctx.acceptedNames) ? redactNames(h.ar, ctx.acceptedNames, "؟؟") : h.ar;
      const en = leaksAnswer(h.en, ctx.acceptedNames) ? redactNames(h.en, ctx.acceptedNames, "??") : h.en;
      if (/^[\s؟?:،,·]*$/.test(ar.replace(/^[^:]*:/, ""))) continue;
      out.push({ level: out.length + 1, kind, ar, en, cost: HINT_COST[kind] });
    } else {
      out.push({ level: out.length + 1, kind, ...h, cost: HINT_COST[kind] });
    }
  }
  return out;
}

export function letterHint(name: string, lang: "ar" | "en"): string {
  const words = name.trim().split(/\s+/);
  const lengths = words.map((w) => [...w.replace(/[^\p{L}\p{N}]/gu, "")].length).filter(Boolean);
  const first = [...name.trim()][0] ?? "";
  const pattern = words.map((w) => [...w].map((ch, i) => (i === 0 && w === words[0] ? ch : /[\p{L}\p{N}]/u.test(ch) ? "_" : ch)).join("")).join("  ");
  return lang === "ar"
    ? `${lengths.length} كلمة (${lengths.join(" + ")} حرف) · أول حرف «${first}» · ${pattern}`
    : `${lengths.length} word(s) (${lengths.join(" + ")} letters) · starts with "${first}" · ${pattern}`;
}

/** Total cost of the first n hints. */
export function hintCost(hints: Hint[], used: number): number {
  return hints.slice(0, used).reduce((s, h) => s + h.cost, 0);
}

export { normalize };
