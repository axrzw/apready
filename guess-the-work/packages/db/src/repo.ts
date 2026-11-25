import type { Category, Character, MediaAsset, ModeId, Person, Theme, Tier, Work } from "@gtw/core/types";
import type { Library } from "@gtw/core/library";

export interface User {
  id: string; // "discord:123" or "dev:name"
  name: string;
  avatar?: string;
  isAdmin?: boolean;
  linked?: { anilist?: string; mal?: string; steam?: string; letterboxd?: string };
  createdAt?: number;
}

export interface AnswerRecord {
  userId: string;
  questionKey: string;
  mode: ModeId | "describer" | "drawer" | string;
  workId: string;
  category: Category;
  tier: Tier;
  correct: boolean;
  points: number;
  method: "text" | "choice";
  hintsUsed: number;
  roomCode?: string;
  /** extra role info for party modes */
  role?: "describer" | "drawer" | "guesser";
  at: number;
}

export interface Report {
  id: string;
  userId: string;
  questionKey: string;
  workId?: string;
  reason: string;
  status: "open" | "fixed" | "ignored";
  at: number;
}

export interface Drawing {
  id: string;
  roomCode: string;
  userId: string;
  workId: string;
  subject: string;
  png: string; // relative path in media dir
  votesBest: number;
  votesFunny: number;
  at: number;
}

export interface LeaderRow {
  userId: string;
  name: string;
  points: number;
  correct: number;
  answers: number;
}

export interface PlayerStats {
  userId: string;
  totalPoints: number;
  accuracy: number;
  byCategory: { category: string; correct: number; answers: number }[];
  byMode: { mode: string; correct: number; answers: number }[];
  hiddenGemsKnown: number;
  obscureKnown: number;
  describerPoints: number;
  drawerPoints: number;
}

export interface WorkFilter {
  category?: Category;
  tier?: Tier;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CoverageRow {
  category: string;
  tier: string;
  decade: number | null;
  genre: string | null;
  count: number;
}

/** The app talks to the database only through this. SQLite today, Supabase later. */
export interface Repo {
  upsertWorks(works: Work[]): Promise<void>;
  upsertCharacters(chars: Character[]): Promise<void>;
  upsertPeople(people: Person[]): Promise<void>;
  upsertThemes(themes: Theme[]): Promise<void>;
  upsertMedia(media: MediaAsset[]): Promise<void>;
  deleteMedia(id: string): Promise<void>;
  addAlias(kind: "work" | "character" | "person", id: string, alias: string): Promise<void>;
  setArabicName(kind: "work" | "character" | "person", id: string, nameAr: string): Promise<void>;
  getWork(id: string): Promise<Work | undefined>;
  listWorks(f?: WorkFilter): Promise<Work[]>;
  counts(): Promise<{ works: number; characters: number; people: number; themes: number; media: number }>;
  coverage(): Promise<CoverageRow[]>;
  loadLibrary(): Promise<Library>;

  upsertUser(u: User): Promise<void>;
  getUser(id: string): Promise<User | undefined>;
  listUsers(): Promise<User[]>;

  recordAnswer(a: AnswerRecord): Promise<void>;
  seen(userIds: string[]): Promise<Map<string, number>>;
  leaderboard(opts?: { mode?: string; since?: number; roomCode?: string }): Promise<LeaderRow[]>;
  playerStats(userId: string): Promise<PlayerStats>;
  accuracy(userIds: string[], lastN?: number): Promise<number | null>;

  addReport(r: Omit<Report, "id" | "status" | "at">): Promise<Report>;
  listReports(status?: Report["status"]): Promise<Report[]>;
  setReportStatus(id: string, status: Report["status"]): Promise<void>;

  saveDrawing(d: Drawing): Promise<void>;
  voteDrawing(id: string, kind: "best" | "funny"): Promise<void>;
  listDrawings(roomCode?: string): Promise<Drawing[]>;
  getDrawing(id: string): Promise<Drawing | undefined>;

  getSetting<T>(key: string): Promise<T | undefined>;
  setSetting<T>(key: string, value: T): Promise<void>;
  logJob(name: string, status: string, detail?: string): Promise<void>;
  listJobs(limit?: number): Promise<{ name: string; status: string; detail: string | null; at: number }[]>;
}
