import type { Category, Tier, TierMix } from "./types";
import { TIERS } from "./types";
import { allocate } from "./tiers";
import type { Rng } from "./rng";

export interface Candidate {
  /** unique key of the question material (e.g. "poster:anilist:1") used for "don't repeat" */
  key: string;
  workId: string;
  tier: Tier;
  category: Category;
  year?: number;
  genres?: string[];
  studios?: string[];
}

export interface SelectOptions {
  count: number;
  mix: TierMix;
  rng: Rng;
  /** key -> last time (ms) any of the players saw it */
  seen?: Map<string, number>;
  now?: number;
  /** a seen question may come back after this many days (or when nothing unseen is left) */
  repeatAfterDays?: number;
  categories?: Category[];
}

function decade(y?: number) {
  return y ? Math.floor(y / 10) : -1;
}

/**
 * Picks `count` candidates: tier quotas from the mix, never two from the same work,
 * unseen first, and spread over decades, genres and studios.
 */
export function selectQuestions<C extends Candidate>(pool: readonly C[], o: SelectOptions): C[] {
  const now = o.now ?? Date.now();
  const repeatMs = (o.repeatAfterDays ?? 30) * 86_400_000;
  const filtered = o.categories?.length ? pool.filter((c) => o.categories!.includes(c.category)) : [...pool];
  const fresh = (c: C) => {
    const t = o.seen?.get(c.key);
    return t === undefined || now - t >= repeatMs;
  };
  const byTier = new Map<Tier, C[]>(TIERS.map((t) => [t, filtered.filter((c) => c.tier === t)]));
  const quota = allocate(o.count, o.mix);
  // move quota from empty tiers to the others
  let spare = 0;
  for (const t of TIERS) {
    const avail = byTier.get(t)!.length;
    if (quota[t] > avail) {
      spare += quota[t] - avail;
      quota[t] = avail;
    }
  }
  for (const t of [...TIERS].sort((a, b) => (o.mix[b] ?? 0) - (o.mix[a] ?? 0))) {
    if (!spare) break;
    const room = byTier.get(t)!.length - quota[t];
    const add = Math.min(room, spare);
    quota[t] += add;
    spare -= add;
  }

  const chosen: C[] = [];
  const usedWorks = new Set<string>();
  const decades = new Map<number, number>();
  const genres = new Map<string, number>();
  const studios = new Map<string, number>();
  const weight = (c: C) => {
    let w = 1;
    w /= 1 + 2 * (decades.get(decade(c.year)) ?? 0);
    for (const g of c.genres ?? []) w /= 1 + 0.5 * (genres.get(g) ?? 0);
    for (const s of c.studios ?? []) w /= 1 + 2 * (studios.get(s) ?? 0);
    return w;
  };
  const take = (c: C) => {
    chosen.push(c);
    usedWorks.add(c.workId);
    decades.set(decade(c.year), (decades.get(decade(c.year)) ?? 0) + 1);
    for (const g of c.genres ?? []) genres.set(g, (genres.get(g) ?? 0) + 1);
    for (const s of c.studios ?? []) studios.set(s, (studios.get(s) ?? 0) + 1);
  };

  const order = TIERS.flatMap((t) => Array<Tier>(quota[t]).fill(t));
  // interleave tiers so the game doesn't start with all the famous ones
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(o.rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const tier of order) {
    const list = byTier.get(tier)!.filter((c) => !chosen.includes(c));
    let options = list.filter((c) => !usedWorks.has(c.workId) && fresh(c));
    if (!options.length) options = list.filter((c) => !usedWorks.has(c.workId));
    if (!options.length) options = list;
    if (!options.length) continue;
    if (!options.some(fresh)) {
      // library exhausted: oldest seen first
      options = [...options].sort((a, b) => (o.seen?.get(a.key) ?? 0) - (o.seen?.get(b.key) ?? 0)).slice(0, 20);
    }
    const ws = options.map(weight);
    let r = o.rng() * ws.reduce((a, b) => a + b, 0);
    let idx = 0;
    for (; idx < ws.length - 1; idx++) {
      r -= ws[idx];
      if (r <= 0) break;
    }
    take(options[idx]);
  }
  return chosen;
}
