import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { Character, MediaAsset, Person, Theme, Work } from "@gtw/core/types";
import type { Library } from "@gtw/core/library";
import * as t from "./schema";
import type {
  AnswerRecord,
  CoverageRow,
  Drawing,
  LeaderRow,
  Pack,
  PlayerStats,
  Report,
  Repo,
  RoomRow,
  SessionSummary,
  Template,
  User,
  WatchEntry,
  WorkFilter,
} from "./repo";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DB = PgDatabase<any, any, any>;

const CHUNK = 400;
function chunks<T>(a: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}
const uniq = (a: (string | undefined)[]) => [...new Set(a.filter((x): x is string => !!x && !!x.trim()))];

type Named = { id: string; nameAr?: string; aliases: string[] };
function mergeNames<T extends Named>(n: T, p?: T): T {
  return p ? { ...n, nameAr: n.nameAr ?? p.nameAr, aliases: uniq([...n.aliases, ...p.aliases]) } : n;
}

export class PgRepo implements Repo {
  constructor(public db: DB) {}

  private async existing<T>(table: typeof t.works | typeof t.characters | typeof t.people, ids: string[]): Promise<Map<string, T>> {
    const m = new Map<string, T>();
    for (const part of chunks(ids, 1000)) {
      const rows = await this.db.select({ id: table.id, data: table.data }).from(table).where(inArray(table.id, part));
      for (const r of rows) m.set(r.id, r.data as T);
    }
    return m;
  }

  async upsertWorks(works: Work[]) {
    const old = await this.existing<Work>(t.works, works.map((w) => w.id));
    for (const part of chunks(works)) {
      const rows = part.map((w) => {
        const p = old.get(w.id);
        // names added by hand (Arabic, dub, voted aliases) and OCR boxes survive a new pull
        const m: Work = p ? { ...p, ...w, titleAr: w.titleAr ?? p.titleAr, aliases: uniq([...w.aliases, ...p.aliases]) } : w;
        return { id: m.id, category: m.category, tier: m.tier, popularity: m.popularity, score: m.score ?? null, year: m.year ?? null, title: m.title, data: m, updatedAt: Date.now() };
      });
      await this.db
        .insert(t.works)
        .values(rows)
        .onConflictDoUpdate({
          target: t.works.id,
          set: { category: sql`excluded.category`, tier: sql`excluded.tier`, popularity: sql`excluded.popularity`, score: sql`excluded.score`, year: sql`excluded.year`, title: sql`excluded.title`, data: sql`excluded.data`, updatedAt: sql`excluded.updated_at` },
        });
    }
  }
  async upsertCharacters(chars: Character[]) {
    const old = await this.existing<Character>(t.characters, chars.map((c) => c.id));
    for (const part of chunks(chars))
      await this.db
        .insert(t.characters)
        .values(part.map((c) => ({ id: c.id, workId: c.workId, data: mergeNames(c, old.get(c.id)) })))
        .onConflictDoUpdate({ target: t.characters.id, set: { workId: sql`excluded.work_id`, data: sql`excluded.data` } });
  }
  async upsertPeople(people: Person[]) {
    const old = await this.existing<Person>(t.people, people.map((c) => c.id));
    for (const part of chunks(people))
      await this.db
        .insert(t.people)
        .values(part.map((p) => ({ id: p.id, data: mergeNames(p, old.get(p.id)) })))
        .onConflictDoUpdate({ target: t.people.id, set: { data: sql`excluded.data` } });
  }
  async upsertThemes(themes: Theme[]) {
    for (const part of chunks(themes))
      await this.db.insert(t.themes).values(part.map((x) => ({ id: x.id, workId: x.workId, data: x }))).onConflictDoUpdate({ target: t.themes.id, set: { workId: sql`excluded.work_id`, data: sql`excluded.data` } });
  }
  async upsertMedia(media: MediaAsset[]) {
    for (const part of chunks(media))
      await this.db
        .insert(t.media)
        .values(part.map((x) => ({ id: x.id, workId: x.workId, kind: x.kind, data: x })))
        .onConflictDoUpdate({ target: t.media.id, set: { workId: sql`excluded.work_id`, kind: sql`excluded.kind`, data: sql`excluded.data` } });
  }
  async deleteMedia(id: string) {
    await this.db.delete(t.media).where(eq(t.media.id, id));
  }

  private table(kind: "work" | "character" | "person") {
    return kind === "work" ? t.works : kind === "character" ? t.characters : t.people;
  }
  private async patch(kind: "work" | "character" | "person", id: string, fn: (d: Record<string, unknown>) => void) {
    const tb = this.table(kind);
    const [row] = await this.db.select({ data: tb.data }).from(tb).where(eq(tb.id, id));
    if (!row) throw new Error(`${kind} ${id} not found`);
    const d = row.data as Record<string, unknown>;
    fn(d);
    await this.db.update(tb).set({ data: d }).where(eq(tb.id, id));
  }
  async addAlias(kind: "work" | "character" | "person", id: string, alias: string) {
    await this.patch(kind, id, (d) => void (d.aliases = uniq([...((d.aliases as string[]) ?? []), alias.trim()])));
  }
  async setArabicName(kind: "work" | "character" | "person", id: string, nameAr: string) {
    await this.patch(kind, id, (d) => void (d[kind === "work" ? "titleAr" : "nameAr"] = nameAr.trim()));
  }
  async getWork(id: string) {
    const [r] = await this.db.select({ data: t.works.data }).from(t.works).where(eq(t.works.id, id));
    return r?.data as Work | undefined;
  }
  async listWorks(f: WorkFilter = {}) {
    const conds = [];
    if (f.category) conds.push(eq(t.works.category, f.category));
    if (f.tier) conds.push(eq(t.works.tier, f.tier));
    if (f.search) conds.push(sql`(${t.works.title} ilike ${"%" + f.search + "%"} or ${t.works.data}::text ilike ${"%" + f.search + "%"})`);
    const rows = await this.db
      .select({ data: t.works.data })
      .from(t.works)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(t.works.popularity))
      .limit(f.limit ?? 50)
      .offset(f.offset ?? 0);
    return rows.map((r) => r.data as Work);
  }
  async counts() {
    const c = async (tb: typeof t.works | typeof t.characters | typeof t.people | typeof t.themes | typeof t.media) => Number((await this.db.select({ n: sql<number>`count(*)` }).from(tb))[0].n);
    return { works: await c(t.works), characters: await c(t.characters), people: await c(t.people), themes: await c(t.themes), media: await c(t.media) };
  }
  async coverage(): Promise<CoverageRow[]> {
    const rows = await this.db.execute(
      sql`select category, tier, (year / 10) * 10 as decade, data->'genres'->>0 as genre, count(*)::int as count from works group by 1, 2, 3, 4`,
    );
    return (rowsOf(rows) as unknown as CoverageRow[]).map((r) => ({ ...r, decade: r.decade === null ? null : Number(r.decade), count: Number(r.count) }));
  }
  private async all<T>(tb: typeof t.works | typeof t.characters | typeof t.people | typeof t.themes | typeof t.media): Promise<T[]> {
    const out: T[] = [];
    for (let off = 0; ; off += 5000) {
      const rows = await this.db.select({ data: tb.data }).from(tb).orderBy(tb.id).limit(5000).offset(off);
      out.push(...rows.map((r) => r.data as T));
      if (rows.length < 5000) return out;
    }
  }
  async loadLibrary(): Promise<Library> {
    const [works, characters, people, themes, media] = await Promise.all([this.all<Work>(t.works), this.all<Character>(t.characters), this.all<Person>(t.people), this.all<Theme>(t.themes), this.all<MediaAsset>(t.media)]);
    return { works, characters, people, themes, media };
  }

  async upsertUser(u: User) {
    const old = await this.getUser(u.id);
    const merged = { ...old, ...u, linked: { ...old?.linked, ...u.linked } };
    delete (merged as { createdAt?: number }).createdAt;
    await this.db
      .insert(t.users)
      .values({ id: u.id, data: merged, createdAt: old?.createdAt ?? Date.now() })
      .onConflictDoUpdate({ target: t.users.id, set: { data: sql`excluded.data` } });
  }
  async getUser(id: string) {
    const [r] = await this.db.select().from(t.users).where(eq(t.users.id, id));
    return r ? { ...(r.data as User), createdAt: Number(r.createdAt) } : undefined;
  }
  async listUsers() {
    return (await this.db.select().from(t.users).orderBy(t.users.createdAt)).map((r) => ({ ...(r.data as User), createdAt: Number(r.createdAt) }));
  }

  async recordAnswer(a: AnswerRecord) {
    await this.db.insert(t.answers).values({
      userId: a.userId,
      questionKey: a.questionKey,
      mode: a.mode,
      workId: a.workId,
      category: a.category,
      tier: a.tier,
      correct: a.correct ? 1 : 0,
      points: Math.round(a.points),
      method: a.method,
      hintsUsed: a.hintsUsed,
      roomCode: a.roomCode ?? null,
      role: a.role ?? null,
      elapsedMs: a.elapsedMs ?? null,
      at: a.at,
    });
  }
  async seen(userIds: string[]) {
    const m = new Map<string, number>();
    if (!userIds.length) return m;
    const rows = await this.db.select({ k: t.answers.questionKey, at: sql<number>`max(${t.answers.at})` }).from(t.answers).where(inArray(t.answers.userId, userIds)).groupBy(t.answers.questionKey);
    for (const r of rows) m.set(r.k, Number(r.at));
    return m;
  }
  async leaderboard(opts: { mode?: string; since?: number; roomCode?: string } = {}): Promise<LeaderRow[]> {
    const conds = [];
    if (opts.mode) conds.push(eq(t.answers.mode, opts.mode));
    if (opts.since) conds.push(sql`${t.answers.at} >= ${opts.since}`);
    if (opts.roomCode) conds.push(eq(t.answers.roomCode, opts.roomCode));
    const rows = await this.db
      .select({ userId: t.answers.userId, p: sql<number>`sum(${t.answers.points})`, c: sql<number>`sum(${t.answers.correct})`, n: sql<number>`count(*)` })
      .from(t.answers)
      .where(conds.length ? and(...conds) : undefined)
      .groupBy(t.answers.userId)
      .orderBy(desc(sql`sum(${t.answers.points})`));
    const users = new Map((await this.listUsers()).map((u) => [u.id, u]));
    return rows.map((r) => ({ userId: r.userId, name: users.get(r.userId)?.name ?? r.userId, points: Number(r.p), correct: Number(r.c), answers: Number(r.n) }));
  }
  async playerStats(userId: string): Promise<PlayerStats> {
    const rows = await this.db.select().from(t.answers).where(eq(t.answers.userId, userId));
    const g = rows.filter((r) => (r.role ?? "guesser") === "guesser");
    const by = (k: "category" | "mode") => {
      const m = new Map<string, { correct: number; answers: number }>();
      for (const r of g) {
        const e = m.get(r[k]) ?? { correct: 0, answers: 0 };
        e.correct += r.correct;
        e.answers++;
        m.set(r[k], e);
      }
      return [...m.entries()];
    };
    const roleP = (role: string) => rows.filter((r) => r.role === role).reduce((s, r) => s + r.points, 0);
    const known = (tier: string) => new Set(rows.filter((r) => r.tier === tier && r.correct).map((r) => r.workId)).size;
    const correct = g.reduce((s, r) => s + r.correct, 0);
    return {
      userId,
      totalPoints: g.reduce((s, r) => s + r.points, 0) + roleP("describer") + roleP("drawer"),
      accuracy: g.length ? correct / g.length : 0,
      byCategory: by("category").map(([category, v]) => ({ category, ...v })),
      byMode: by("mode").map(([mode, v]) => ({ mode, ...v })),
      hiddenGemsKnown: known("hidden_gem"),
      obscureKnown: known("obscure"),
      describerPoints: roleP("describer"),
      drawerPoints: roleP("drawer"),
    };
  }
  async accuracy(userIds: string[], lastN = 50) {
    if (!userIds.length) return null;
    const rows = await this.db
      .select({ c: t.answers.correct })
      .from(t.answers)
      .where(and(inArray(t.answers.userId, userIds), sql`coalesce(${t.answers.role}, 'guesser') = 'guesser'`))
      .orderBy(desc(t.answers.at))
      .limit(lastN);
    if (rows.length < 10) return null;
    return rows.reduce((s, r) => s + r.c, 0) / rows.length;
  }

  async addReport(r: Omit<Report, "id" | "status" | "at">) {
    const rep: Report = { ...r, id: crypto.randomUUID(), status: "open", at: Date.now() };
    await this.db.insert(t.reports).values({ ...rep, workId: rep.workId ?? null });
    return rep;
  }
  async listReports(status?: Report["status"]) {
    const rows = await this.db.select().from(t.reports).where(status ? eq(t.reports.status, status) : undefined).orderBy(desc(t.reports.at));
    return rows.map((r) => ({ ...r, workId: r.workId ?? undefined, status: r.status as Report["status"], at: Number(r.at) }));
  }
  async setReportStatus(id: string, status: Report["status"]) {
    await this.db.update(t.reports).set({ status }).where(eq(t.reports.id, id));
  }
  async saveDrawing(d: Drawing) {
    await this.db.insert(t.drawings).values(d).onConflictDoUpdate({ target: t.drawings.id, set: { votesBest: d.votesBest, votesFunny: d.votesFunny } });
  }
  async voteDrawing(id: string, kind: "best" | "funny") {
    await this.db
      .update(t.drawings)
      .set(kind === "best" ? { votesBest: sql`${t.drawings.votesBest} + 1` } : { votesFunny: sql`${t.drawings.votesFunny} + 1` })
      .where(eq(t.drawings.id, id));
  }
  async listDrawings(roomCode?: string) {
    return (await this.db.select().from(t.drawings).where(roomCode ? eq(t.drawings.roomCode, roomCode) : undefined).orderBy(desc(t.drawings.at)).limit(500)).map((d) => ({ ...d, at: Number(d.at) }));
  }
  async getDrawing(id: string) {
    const [d] = await this.db.select().from(t.drawings).where(eq(t.drawings.id, id));
    return d ? { ...d, at: Number(d.at) } : undefined;
  }
  async getSetting<T>(key: string) {
    const [r] = await this.db.select().from(t.settings).where(eq(t.settings.key, key));
    return r?.value as T | undefined;
  }
  async setSetting<T>(key: string, value: T) {
    await this.db.insert(t.settings).values({ key, value }).onConflictDoUpdate({ target: t.settings.key, set: { value: sql`excluded.value` } });
  }
  async logJob(name: string, status: string, detail?: string) {
    await this.db.insert(t.jobs).values({ name, status, detail: detail ?? null, at: Date.now() });
  }
  async listJobs(limit = 50) {
    return (await this.db.select().from(t.jobs).orderBy(desc(t.jobs.id)).limit(limit)).map((j) => ({ name: j.name, status: j.status, detail: j.detail, at: Number(j.at) }));
  }

  async getRoom<S>(code: string): Promise<RoomRow<S> | undefined> {
    const [r] = await this.db.select().from(t.rooms).where(eq(t.rooms.code, code));
    return r ? { code: r.code, version: r.version, state: r.state as S, updatedAt: Number(r.updatedAt) } : undefined;
  }
  async saveRoom<S>(code: string, state: S, expectedVersion: number): Promise<boolean> {
    const now = Date.now();
    if (expectedVersion === 0) {
      const r = await this.db.insert(t.rooms).values({ code, version: 1, state, updatedAt: now }).onConflictDoNothing().returning({ code: t.rooms.code });
      return r.length === 1;
    }
    const r = await this.db
      .update(t.rooms)
      .set({ state, version: expectedVersion + 1, updatedAt: now })
      .where(and(eq(t.rooms.code, code), eq(t.rooms.version, expectedVersion)))
      .returning({ code: t.rooms.code });
    return r.length === 1;
  }
  async deleteRoomsBefore(ts: number) {
    const r = await this.db.delete(t.rooms).where(lt(t.rooms.updatedAt, ts)).returning({ code: t.rooms.code });
    return r.length;
  }

  async setWatch(e: WatchEntry) {
    await this.db
      .insert(t.watch)
      .values({ ...e, rating: e.rating ?? null })
      .onConflictDoUpdate({ target: [t.watch.userId, t.watch.workId], set: { status: e.status, rating: e.rating ?? null, at: e.at } });
  }
  async removeWatch(userId: string, workId: string) {
    await this.db.delete(t.watch).where(and(eq(t.watch.userId, userId), eq(t.watch.workId, workId)));
  }
  private watchRow = (r: typeof t.watch.$inferSelect): WatchEntry => ({ userId: r.userId, workId: r.workId, status: r.status as WatchEntry["status"], rating: r.rating ?? undefined, at: Number(r.at) });
  async watchOf(userId: string) {
    return (await this.db.select().from(t.watch).where(eq(t.watch.userId, userId)).orderBy(desc(t.watch.at))).map(this.watchRow);
  }
  async watchAll() {
    return (await this.db.select().from(t.watch)).map(this.watchRow);
  }
  async addWish(userId: string, workId: string) {
    await this.db.insert(t.wishlist).values({ userId, workId, at: Date.now() }).onConflictDoNothing();
  }
  async removeWish(userId: string, workId: string) {
    await this.db.delete(t.wishlist).where(and(eq(t.wishlist.userId, userId), eq(t.wishlist.workId, workId)));
  }
  async wishesOf(userId: string) {
    return (await this.db.select().from(t.wishlist).where(eq(t.wishlist.userId, userId)).orderBy(desc(t.wishlist.at))).map((r) => r.workId);
  }

  async saveTemplate(x: Template) {
    await this.db.insert(t.templates).values(x).onConflictDoUpdate({ target: t.templates.id, set: { name: x.name, settings: x.settings as object, at: x.at } });
  }
  async listTemplates() {
    return (await this.db.select().from(t.templates).orderBy(desc(t.templates.at))).map((r) => ({ ...r, at: Number(r.at) }));
  }
  async deleteTemplate(id: string) {
    await this.db.delete(t.templates).where(eq(t.templates.id, id));
  }
  async saveSession(s: SessionSummary) {
    await this.db.insert(t.sessions).values({ ...s, summary: s.summary as object }).onConflictDoUpdate({ target: t.sessions.id, set: { summary: s.summary as object } });
  }
  async listSessions(limit = 50) {
    return (await this.db.select().from(t.sessions).orderBy(desc(t.sessions.at)).limit(limit)).map((r) => ({ ...r, at: Number(r.at) }));
  }
  async getSession(id: string) {
    const [r] = await this.db.select().from(t.sessions).where(eq(t.sessions.id, id));
    return r ? { ...r, at: Number(r.at) } : undefined;
  }
  async savePack(p: Pack) {
    await this.db.insert(t.packs).values({ ...p, data: p.data as object }).onConflictDoUpdate({ target: t.packs.id, set: { name: p.name, data: p.data as object, at: p.at } });
  }
  async listPacks() {
    return (await this.db.select().from(t.packs).orderBy(desc(t.packs.at))).map((r) => ({ ...r, at: Number(r.at) }));
  }
  async getPack(id: string) {
    const [r] = await this.db.select().from(t.packs).where(eq(t.packs.id, id));
    return r ? { ...r, at: Number(r.at) } : undefined;
  }
  async answersOfRoom(roomCode: string) {
    const rows = await this.db.select().from(t.answers).where(eq(t.answers.roomCode, roomCode)).orderBy(t.answers.id);
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      questionKey: r.questionKey,
      mode: r.mode,
      workId: r.workId,
      category: r.category as AnswerRecord["category"],
      tier: r.tier as AnswerRecord["tier"],
      correct: !!r.correct,
      points: r.points,
      method: r.method as AnswerRecord["method"],
      hintsUsed: r.hintsUsed,
      roomCode: r.roomCode ?? undefined,
      role: (r.role ?? undefined) as AnswerRecord["role"],
      elapsedMs: r.elapsedMs ?? undefined,
      at: Number(r.at),
    }));
  }

  private tables() {
    return { works: t.works, characters: t.characters, people: t.people, themes: t.themes, media: t.media, users: t.users, answers: t.answers, reports: t.reports, drawings: t.drawings, settings: t.settings, jobs: t.jobs, watch: t.watch, wishlist: t.wishlist, templates: t.templates, sessions: t.sessions, packs: t.packs };
  }
  async dump() {
    const out: Record<string, unknown[]> = {};
    for (const [name, tb] of Object.entries(this.tables())) {
      const rows: unknown[] = [];
      for (let off = 0; ; off += 5000) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const part = await this.db.select().from(tb as any).limit(5000).offset(off);
        rows.push(...part);
        if (part.length < 5000) break;
      }
      out[name] = rows;
    }
    return out;
  }
  async restore(d: Record<string, unknown[]>) {
    for (const [name, tb] of Object.entries(this.tables())) {
      const rows = d[name];
      if (!rows?.length) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const part of chunks(rows, 300)) await this.db.insert(tb as any).values(part as any).onConflictDoNothing();
    }
    // serial columns continue after the restored ids
    for (const s of ["answers", "jobs"]) await this.db.execute(sql.raw(`select setval(pg_get_serial_sequence('${s}', 'id'), coalesce((select max(id) from ${s}), 0) + 1, false)`));
  }
}

function rowsOf(r: unknown): Record<string, unknown>[] {
  return Array.isArray(r) ? r : ((r as { rows: Record<string, unknown>[] }).rows ?? []);
}
