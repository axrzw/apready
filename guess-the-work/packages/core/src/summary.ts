import type { Tier } from "./types";

/** End-of-night summary (SPEC 11) and automatic titles. Pure: the server feeds it the stored answers. */
export interface SummaryAnswer {
  userId: string;
  questionKey: string;
  workId: string;
  mode: string;
  tier: Tier;
  correct: boolean;
  points: number;
  hintsUsed: number;
  elapsedMs?: number;
  role?: string;
}

export interface SessionSummary {
  ranking: { userId: string; name: string; score: number; color?: string; avatar?: string }[];
  fastest?: { userId: string; ms: number; workId: string };
  hardest?: { workId: string; tier: Tier; solvedBy: string[] };
  weirdest?: { workId: string; tier: Tier };
  bestDrawing?: { id: string; userId: string; votes: number };
  funniestDrawing?: { id: string; userId: string; votes: number };
  mostHints?: { userId: string; count: number };
  questions: number;
}

const TIER_RANK: Record<Tier, number> = { mainstream: 0, mid: 1, hidden_gem: 2, obscure: 3 };

export function buildSummary(o: {
  players: { id: string; name: string; score: number; color?: string; avatar?: string }[];
  answers: SummaryAnswer[];
  drawings?: { id: string; userId: string; votesBest: number; votesFunny: number }[];
}): SessionSummary {
  const g = o.answers.filter((a) => (a.role ?? "guesser") === "guesser");
  const byQ = new Map<string, SummaryAnswer[]>();
  for (const a of g) byQ.set(a.questionKey, [...(byQ.get(a.questionKey) ?? []), a]);
  const right = g.filter((a) => a.correct && a.elapsedMs !== undefined && a.elapsedMs >= 0);
  const fast = right.sort((a, b) => a.elapsedMs! - b.elapsedMs!)[0];
  // hardest solved: most obscure tier, then fewest solvers
  const solved = [...byQ.values()].filter((qs) => qs.some((a) => a.correct));
  const hard = solved.sort((a, b) => TIER_RANK[b[0].tier] - TIER_RANK[a[0].tier] || a.filter((x) => x.correct).length - b.filter((x) => x.correct).length)[0];
  const unsolved = [...byQ.values()].filter((qs) => !qs.some((a) => a.correct)).sort((a, b) => TIER_RANK[b[0].tier] - TIER_RANK[a[0].tier]);
  const hints = new Map<string, number>();
  for (const a of g) hints.set(a.userId, (hints.get(a.userId) ?? 0) + a.hintsUsed);
  const topHints = [...hints.entries()].sort((a, b) => b[1] - a[1])[0];
  const draw = (k: "votesBest" | "votesFunny") => {
    const d = [...(o.drawings ?? [])].sort((a, b) => b[k] - a[k])[0];
    return d && d[k] > 0 ? { id: d.id, userId: d.userId, votes: d[k] } : undefined;
  };
  return {
    ranking: [...o.players].sort((a, b) => b.score - a.score).map((p) => ({ userId: p.id, name: p.name, score: p.score, color: p.color, avatar: p.avatar })),
    fastest: fast ? { userId: fast.userId, ms: fast.elapsedMs!, workId: fast.workId } : undefined,
    hardest: hard ? { workId: hard[0].workId, tier: hard[0].tier, solvedBy: hard.filter((a) => a.correct).map((a) => a.userId) } : undefined,
    weirdest: unsolved[0] ? { workId: unsolved[0][0].workId, tier: unsolved[0][0].tier } : undefined,
    bestDrawing: draw("votesBest"),
    funniestDrawing: draw("votesFunny"),
    mostHints: topHints && topHints[1] > 0 ? { userId: topHints[0], count: topHints[1] } : undefined,
    questions: byQ.size,
  };
}

export interface TitleStats {
  userId: string;
  obscureKnown: number;
  hiddenGemsKnown: number;
  byMode: { mode: string; correct: number; answers: number }[];
  drawerPoints: number;
  describerPoints: number;
  accuracy: number;
  answers: number;
}

/** Automatic titles: each goes to the one player who earns it most. */
export function titlesFor(all: TitleStats[]): Map<string, string[]> {
  const out = new Map<string, string[]>(all.map((s) => [s.userId, []]));
  const give = (title: string, score: (s: TitleStats) => number, min: number) => {
    const best = [...all].sort((a, b) => score(b) - score(a))[0];
    if (best && score(best) >= min) out.get(best.userId)!.push(title);
  };
  const rate = (s: TitleStats, mode: string) => {
    const m = s.byMode.find((x) => x.mode === mode);
    return m && m.answers >= 5 ? m.correct / m.answers : null;
  };
  give("ملك المغمور", (s) => s.obscureKnown, 5);
  give("صياد المظلوم", (s) => s.hiddenGemsKnown, 5);
  give("الرسام الأسطوري", (s) => s.drawerPoints, 300);
  give("الواصف الذهبي", (s) => s.describerPoints, 300);
  give("ملك الأوبننقات", (s) => rate(s, "opening") ?? 0, 0.7);
  give("عدو الأوبننقات", (s) => (rate(s, "opening") === null ? 0 : 1 - rate(s, "opening")!), 0.7);
  give("عين الصقر", (s) => (s.answers >= 20 ? s.accuracy : 0), 0.6);
  return out;
}
