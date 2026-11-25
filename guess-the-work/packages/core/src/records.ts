import type { Category, Tier } from "./types";

/** A row the server stores for stats (same shape as @gtw/db AnswerRecord without room/time). */
export interface AnswerRecord {
  userId: string;
  questionKey: string;
  mode: string;
  workId: string;
  category: Category;
  tier: Tier;
  correct: boolean;
  points: number;
  method: "text" | "choice";
  hintsUsed: number;
  role?: "describer" | "drawer" | "guesser";
}
