import type { Category, Tier, TierMix, Work } from "./types";
import { TIERS } from "./types";

/**
 * Popularity thresholds per category (source popularity numbers):
 * anime = AniList members, game = IGDB rating count, movie/series = TMDB vote_count
 * (TVmaze weight*100 when TMDB is not used), vn = VNDB vote count.
 */
export interface TierRule {
  mainstream: number;
  mid: number;
  /** score (0-100) at or above which a less popular work is a hidden gem */
  gemScore: number;
}

export const TIER_RULES: Record<Category, TierRule> = {
  anime: { mainstream: 250_000, mid: 50_000, gemScore: 74 },
  game: { mainstream: 800, mid: 120, gemScore: 78 },
  movie: { mainstream: 8_000, mid: 1_500, gemScore: 72 },
  series: { mainstream: 4_000, mid: 800, gemScore: 76 },
  vn: { mainstream: 3_000, mid: 600, gemScore: 75 },
};

export function computeTier(
  w: Pick<Work, "category" | "popularity" | "score">,
  rules: Record<Category, TierRule> = TIER_RULES,
): Tier {
  const r = rules[w.category];
  if (w.popularity >= r.mainstream) return "mainstream";
  if (w.popularity >= r.mid) return "mid";
  if ((w.score ?? 0) >= r.gemScore) return "hidden_gem";
  return "obscure";
}

/** Split `count` into whole numbers per tier following the mix (largest remainder). */
export function allocate(count: number, mix: TierMix): Record<Tier, number> {
  const total = TIERS.reduce((s, t) => s + Math.max(0, mix[t] ?? 0), 0) || 1;
  const raw = TIERS.map((t) => (Math.max(0, mix[t] ?? 0) / total) * count);
  const out = raw.map(Math.floor);
  let left = count - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return Object.fromEntries(TIERS.map((t, i) => [t, out[i]])) as Record<Tier, number>;
}

/** Players get it right too often -> fewer famous works, and the other way round. */
export function adaptMix(mix: TierMix, accuracy: number, step = 5): TierMix {
  const m = { ...mix };
  if (accuracy > 0.75 && m.mainstream > step) {
    m.mainstream -= step;
    m.obscure += Math.ceil(step / 2);
    m.hidden_gem += Math.floor(step / 2);
  } else if (accuracy < 0.35 && m.obscure > step) {
    m.obscure -= step;
    m.mainstream += step;
  }
  return m;
}
