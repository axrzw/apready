import type { Tier } from "./types";

/** Every number of the scoring (SPEC 11). The admin can change them; rooms keep a copy. */
export interface ScoringConfig {
  base: number;
  tier: Record<Tier, number>;
  /** speed factor at the end of the time (falls linearly from 1) */
  slowest: number;
  choice: number;
  /** autocomplete pick when the room sets "autocomplete with fewer points" */
  autocompleteReduced: number;
  hintCosts: { first4: number; next3: number; last: number };
  hintFloor: number;
  streakStep: number;
  streakMax: number;
  rankBonus: [number, number, number];
  /** describer / drawer: share of each guesser's points */
  helperShare: number;
}

export const DEFAULT_SCORING: ScoringConfig = {
  base: 100,
  tier: { mainstream: 1, mid: 1.25, hidden_gem: 1.5, obscure: 1.75 },
  slowest: 0.5,
  choice: 0.5,
  autocompleteReduced: 0.75,
  hintCosts: { first4: 0.1, next3: 0.15, last: 0.25 },
  hintFloor: 0.2,
  streakStep: 0.1,
  streakMax: 0.5,
  rankBonus: [50, 25, 10],
  helperShare: 0.4,
};

/** Cost of the hint at position i (0-based) when the question has `total` hints: 1-4, 5-7, the last one. */
export function hintCostAt(i: number, total: number, c: ScoringConfig = DEFAULT_SCORING): number {
  if (i === total - 1 && total >= 2) return c.hintCosts.last;
  return i < 4 ? c.hintCosts.first4 : c.hintCosts.next3;
}

export function hintMultiplier(used: number, total: number, c: ScoringConfig = DEFAULT_SCORING): number {
  let cost = 0;
  for (let i = 0; i < used; i++) cost += hintCostAt(i, total, c);
  return Math.max(c.hintFloor, Math.round((1 - cost) * 1000) / 1000);
}

export type ScoreMethod = "text" | "autocomplete" | "autocomplete_reduced" | "choice";

export interface ScoreInput {
  correct: boolean;
  elapsedMs: number;
  timeLimitMs: number;
  tier: Tier;
  method: ScoreMethod;
  hintsUsed: number;
  /** hints the question has (the last one costs more) */
  hintTotal?: number;
  /** correct answers in a row before this one */
  streak: number;
  /** 1 = first correct answer of the question */
  rank: number;
  firstOnly?: boolean;
  /** partial answers (the work instead of the character): share of the points */
  factor?: number;
}

export interface ScoreBreakdown {
  base: number;
  speed: number;
  method: number;
  hints: number;
  streak: number;
  factor: number;
  bonus: number;
  total: number;
}

const ZERO: ScoreBreakdown = { base: 0, speed: 0, method: 0, hints: 0, streak: 0, factor: 0, bonus: 0, total: 0 };

export function scoreAnswer(s: ScoreInput, c: ScoringConfig = DEFAULT_SCORING): ScoreBreakdown {
  const factor = s.factor ?? (s.correct ? 1 : 0);
  if (factor <= 0) return ZERO;
  if (s.firstOnly && s.rank > 1) return { ...ZERO, factor };
  const base = Math.round(c.base * c.tier[s.tier]);
  const t = Math.min(Math.max(s.elapsedMs / Math.max(1, s.timeLimitMs), 0), 1);
  const speed = Math.round((1 - (1 - c.slowest) * t) * 1000) / 1000;
  const method = s.method === "choice" ? c.choice : s.method === "autocomplete_reduced" ? c.autocompleteReduced : 1;
  const hints = hintMultiplier(s.hintsUsed, s.hintTotal ?? 8, c);
  const streak = Math.round((1 + Math.min(c.streakMax, c.streakStep * Math.max(0, s.streak))) * 1000) / 1000;
  const core = Math.round(base * speed * method * hints * streak * factor);
  // the rank bonus is added last, only for full answers without any hint
  const bonus = s.correct && s.hintsUsed === 0 && s.rank >= 1 && s.rank <= 3 ? c.rankBonus[s.rank - 1] : 0;
  return { base, speed, method, hints, streak, factor, bonus, total: core + bonus };
}

/** Points for the describer / drawer for one correct guesser. */
export function helperPoints(guesserPoints: number, c: ScoringConfig = DEFAULT_SCORING): number {
  return Math.round(guesserPoints * c.helperShare);
}

/** Kept for the old call sites: tier multiplier table. */
export const TIER_MULTIPLIER = DEFAULT_SCORING.tier;
