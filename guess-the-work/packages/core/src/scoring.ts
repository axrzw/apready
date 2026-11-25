import type { AnswerMethod, Tier } from "./types";

export const TIER_MULTIPLIER: Record<Tier, number> = { mainstream: 1, mid: 1.2, hidden_gem: 1.5, obscure: 1.8 };

export interface ScoreInput {
  correct: boolean;
  elapsedMs: number;
  timeLimitMs: number;
  tier: Tier;
  method: AnswerMethod;
  /** sum of the costs of the hints this player used (0..1) */
  hintCost?: number;
  /** correct answers in a row before this one */
  streak?: number;
  /** a bonus multiplier from the mode, e.g. 1.5 for "first second only" */
  modeMultiplier?: number;
}

export const BASE_POINTS = 1000;

export function scoreAnswer(s: ScoreInput): number {
  if (!s.correct) return 0;
  const t = Math.min(Math.max(s.elapsedMs / Math.max(1, s.timeLimitMs), 0), 1);
  const speed = 0.5 + 0.5 * (1 - t);
  const method = s.method === "choice" ? 0.5 : 1;
  const hints = Math.max(0.2, 1 - (s.hintCost ?? 0));
  const streak = 1 + Math.min(0.5, 0.1 * (s.streak ?? 0));
  return Math.round(BASE_POINTS * speed * TIER_MULTIPLIER[s.tier] * method * hints * streak * (s.modeMultiplier ?? 1));
}

/** Points for the describer / drawer for each correct guesser. */
export function helperPoints(guesserPoints: number): number {
  return Math.round(guesserPoints * 0.4);
}
