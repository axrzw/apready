import type { Category, Character, MediaAsset, ModeId, Person, Theme, Tier, Work } from "@gtw/core/types";
import type { Library } from "@gtw/core/library";

export interface User {
  id: string;
  name: string;
  /** accent colour (hex) chosen at login */
  color?: string;
  /** avatar glyph id from the list */
  avatar?: string;
  isAdmin?: boolean;
  kicked?: boolean;
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
  elapsedMs?: number;
  at: number;
}

export type WatchStatus = "seen" | "watching" | "dropped" | "not_seen";
export interface WatchEntry {
  userId: string;
  workId: string;
  status: WatchStatus;
  rating?: number;
  at: number;
}

export interface RoomRow<S = unknown> {
  code: string;
  version: number;
  state: S;
  updatedAt: number;
}

export interface Template {
  id: string;
  userId: string;
  name: string;
  settings: unknown;
  at: number;
}

export interface SessionSummary {
  id: string;
  roomCode: string;
  summary: unknown;
  at: number;
}

export interface Pack {
  id: string;
  userId: string;
  name: string;
  data: unknown;
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

/** The app talks to the database only through this (Drizzle on PGlite locally, Neon in production). */
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

  // live rooms (compare-and-swap on version)
  getRoom<S>(code: string): Promise<RoomRow<S> | undefined>;
  /** inserts when expectedVersion is 0; returns false when someone else wrote first */
  saveRoom<S>(code: string, state: S, expectedVersion: number): Promise<boolean>;
  deleteRoomsBefore(ts: number): Promise<number>;

  // watch log, wishlist
  setWatch(e: WatchEntry): Promise<void>;
  removeWatch(userId: string, workId: string): Promise<void>;
  watchOf(userId: string): Promise<WatchEntry[]>;
  watchAll(): Promise<WatchEntry[]>;
  addWish(userId: string, workId: string): Promise<void>;
  removeWish(userId: string, workId: string): Promise<void>;
  wishesOf(userId: string): Promise<string[]>;

  // templates, archive, packs
  saveTemplate(t: Template): Promise<void>;
  listTemplates(): Promise<Template[]>;
  deleteTemplate(id: string): Promise<void>;
  saveSession(s: SessionSummary): Promise<void>;
  listSessions(limit?: number): Promise<SessionSummary[]>;
  getSession(id: string): Promise<SessionSummary | undefined>;
  savePack(p: Pack): Promise<void>;
  listPacks(): Promise<Pack[]>;
  getPack(id: string): Promise<Pack | undefined>;
  answersOfRoom(roomCode: string): Promise<(AnswerRecord & { id: number })[]>;

  /** every row of every table (backup) and restore */
  dump(): Promise<Record<string, unknown[]>>;
  restore(d: Record<string, unknown[]>): Promise<void>;
}
