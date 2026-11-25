import type { Category, Tier } from "./types";

export const CATEGORY_AR: Record<Category, string> = { anime: "أنمي", game: "لعبة", movie: "فيلم", series: "مسلسل", vn: "فجوال نوفل" };
export const CATEGORY_EN: Record<Category, string> = { anime: "Anime", game: "Game", movie: "Movie", series: "Series", vn: "Visual novel" };
export const TIER_AR: Record<Tier, string> = { mainstream: "مشهور", mid: "متوسط", hidden_gem: "مظلوم", obscure: "مغمور" };

export const GENRE_AR: Record<string, string> = {
  Action: "أكشن", Adventure: "مغامرة", Comedy: "كوميدي", Drama: "دراما", Ecchi: "إيتشي", Fantasy: "فانتازيا",
  Horror: "رعب", "Mahou Shoujo": "فتيات سحريات", Mecha: "ميكا", Music: "موسيقى", Mystery: "غموض",
  Psychological: "نفسي", Romance: "رومانسي", "Sci-Fi": "خيال علمي", "Slice of Life": "شريحة من الحياة",
  Sports: "رياضة", Supernatural: "خارق للطبيعة", Thriller: "إثارة", Animation: "رسوم متحركة", Crime: "جريمة",
  Documentary: "وثائقي", Family: "عائلي", History: "تاريخي", War: "حرب", Western: "ويسترن", RPG: "تقمص أدوار",
  Shooter: "تصويب", Platform: "منصات", Puzzle: "ألغاز", Strategy: "استراتيجية", Racing: "سباق", Fighting: "قتال",
  Simulator: "محاكاة", Indie: "مستقلة", Arcade: "أركيد",
};

export const SEASON_AR: Record<string, string> = { WINTER: "الشتاء", SPRING: "الربيع", SUMMER: "الصيف", FALL: "الخريف" };

export function genreAr(g: string): string {
  return GENRE_AR[g] ?? g;
}
