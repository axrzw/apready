import { bigint, doublePrecision, index, integer, jsonb, pgTable, primaryKey, serial, text } from "drizzle-orm/pg-core";

/** One schema for PGlite (local/tests) and Neon (production). `data` holds the full JSON object. */
export const works = pgTable(
  "works",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull(),
    tier: text("tier").notNull(),
    popularity: doublePrecision("popularity").notNull().default(0),
    score: doublePrecision("score"),
    year: integer("year"),
    title: text("title").notNull(),
    data: jsonb("data").notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("works_cat_tier").on(t.category, t.tier)],
);
export const characters = pgTable("characters", { id: text("id").primaryKey(), workId: text("work_id").notNull(), data: jsonb("data").notNull() }, (t) => [index("characters_work").on(t.workId)]);
export const people = pgTable("people", { id: text("id").primaryKey(), data: jsonb("data").notNull() });
export const themes = pgTable("themes", { id: text("id").primaryKey(), workId: text("work_id").notNull(), data: jsonb("data").notNull() });
export const media = pgTable("media", { id: text("id").primaryKey(), workId: text("work_id").notNull(), kind: text("kind").notNull(), data: jsonb("data").notNull() });

export const users = pgTable("users", { id: text("id").primaryKey(), data: jsonb("data").notNull(), createdAt: bigint("created_at", { mode: "number" }).notNull() });

export const answers = pgTable(
  "answers",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    questionKey: text("question_key").notNull(),
    mode: text("mode").notNull(),
    workId: text("work_id").notNull(),
    category: text("category").notNull(),
    tier: text("tier").notNull(),
    correct: integer("correct").notNull(),
    points: integer("points").notNull(),
    method: text("method").notNull(),
    hintsUsed: integer("hints_used").notNull().default(0),
    roomCode: text("room_code"),
    role: text("role"),
    elapsedMs: integer("elapsed_ms"),
    at: bigint("at", { mode: "number" }).notNull(),
  },
  (t) => [index("answers_user").on(t.userId, t.at), index("answers_key").on(t.questionKey), index("answers_room").on(t.roomCode)],
);

export const reports = pgTable("reports", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  questionKey: text("question_key").notNull(),
  workId: text("work_id"),
  reason: text("reason").notNull(),
  status: text("status").notNull(),
  at: bigint("at", { mode: "number" }).notNull(),
});
export const drawings = pgTable("drawings", {
  id: text("id").primaryKey(),
  roomCode: text("room_code").notNull(),
  userId: text("user_id").notNull(),
  workId: text("work_id").notNull(),
  subject: text("subject").notNull(),
  png: text("png").notNull(),
  votesBest: integer("votes_best").notNull().default(0),
  votesFunny: integer("votes_funny").notNull().default(0),
  at: bigint("at", { mode: "number" }).notNull(),
});
export const settings = pgTable("settings", { key: text("key").primaryKey(), value: jsonb("value").notNull() });
export const jobs = pgTable("jobs", { id: serial("id").primaryKey(), name: text("name").notNull(), status: text("status").notNull(), detail: text("detail"), at: bigint("at", { mode: "number" }).notNull() });

/** Live rooms: state machine JSON + version for compare-and-swap (polling clients, serverless). */
export const rooms = pgTable("rooms", {
  code: text("code").primaryKey(),
  version: integer("version").notNull(),
  state: jsonb("state").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

/** Watch log: seen / watching / dropped / not_seen, optional rating 1-10. */
export const watch = pgTable(
  "watch",
  {
    userId: text("user_id").notNull(),
    workId: text("work_id").notNull(),
    status: text("status").notNull(),
    rating: integer("rating"),
    at: bigint("at", { mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.workId] }), index("watch_work").on(t.workId)],
);
export const wishlist = pgTable("wishlist", { userId: text("user_id").notNull(), workId: text("work_id").notNull(), at: bigint("at", { mode: "number" }).notNull() }, (t) => [primaryKey({ columns: [t.userId, t.workId] })]);
export const templates = pgTable("templates", { id: text("id").primaryKey(), userId: text("user_id").notNull(), name: text("name").notNull(), settings: jsonb("settings").notNull(), at: bigint("at", { mode: "number" }).notNull() });
/** Finished sessions (summary for the archive, revenge, head-to-head). */
export const sessions = pgTable("sessions", { id: text("id").primaryKey(), roomCode: text("room_code").notNull(), summary: jsonb("summary").notNull(), at: bigint("at", { mode: "number" }).notNull() });
/** Player question packs ("باقتي"). */
export const packs = pgTable("packs", { id: text("id").primaryKey(), userId: text("user_id").notNull(), name: text("name").notNull(), data: jsonb("data").notNull(), at: bigint("at", { mode: "number" }).notNull() });
