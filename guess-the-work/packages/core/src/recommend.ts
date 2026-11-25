/** Taste similarity and picks from the watch log (SPEC 11). */
export interface Rated {
  userId: string;
  workId: string;
  status: string;
  rating?: number;
}

/** 0..1 from the ratings both gave (null with fewer than `min` shared ratings). */
export function similarity(a: Rated[], b: Rated[], min = 3): { score: number; shared: number } | null {
  const rb = new Map(b.filter((x) => x.rating).map((x) => [x.workId, x.rating!]));
  const diffs = a.filter((x) => x.rating && rb.has(x.workId)).map((x) => Math.abs(x.rating! - rb.get(x.workId)!));
  if (diffs.length < min) return null;
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  return { score: Math.round((1 - mean / 9) * 100) / 100, shared: diffs.length };
}

export interface Pick {
  workId: string;
  from: string[];
  rating: number;
}

/** Works someone rated high (>= minRating) that `me` has not logged. */
export function highlyRatedUnseen(all: Rated[], me: string, minRating = 8): Pick[] {
  const mine = new Set(all.filter((x) => x.userId === me).map((x) => x.workId));
  const by = new Map<string, Pick>();
  for (const x of all) {
    if (x.userId === me || mine.has(x.workId) || (x.rating ?? 0) < minRating) continue;
    const p = by.get(x.workId) ?? { workId: x.workId, from: [], rating: 0 };
    p.from.push(x.userId);
    p.rating = Math.max(p.rating, x.rating!);
    by.set(x.workId, p);
  }
  return [...by.values()].sort((a, b) => b.from.length - a.from.length || b.rating - a.rating || (a.workId < b.workId ? -1 : 1));
}

/** Friends ordered by how close their taste is to mine. */
export function closestFriends(all: Rated[], me: string): { userId: string; score: number; shared: number }[] {
  const mine = all.filter((x) => x.userId === me);
  const users = [...new Set(all.map((x) => x.userId))].filter((u) => u !== me);
  return users
    .map((u) => ({ userId: u, s: similarity(mine, all.filter((x) => x.userId === u)) }))
    .filter((x): x is { userId: string; s: { score: number; shared: number } } => !!x.s)
    .map((x) => ({ userId: x.userId, ...x.s }))
    .sort((a, b) => b.score - a.score || b.shared - a.shared);
}
