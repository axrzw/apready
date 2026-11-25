import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Character, MediaAsset, Person, Theme, Work } from "@gtw/core/types";
import type { Library } from "@gtw/core/library";
import type { AnswerRecord, CoverageRow, Drawing, LeaderRow, PlayerStats, Report, Repo, User, WorkFilter } from "./repo";

/**
 * Same Repo on Supabase (Postgres). Tables: supabase/migrations/0001_init.sql.
 * Used only on the server with the service role key (RLS has no policies, so the browser can read nothing).
 * Not run in CI (no Supabase in the sandbox); the SQLite repo has the tests.
 */
export class SupabaseRepo implements Repo {
  db: SupabaseClient;
  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false } });
  }

  private async ok<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
    const { data, error } = await p;
    if (error) throw new Error(error.message);
    return data as T;
  }

  private async all<T>(table: string, cols = "data"): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const rows = await this.ok<{ data: T }[]>(this.db.from(table).select(cols).range(from, from + 999));
      out.push(...rows.map((r) => r.data));
      if (rows.length < 1000) return out;
    }
  }

  private async existing<T>(table: string, ids: string[]): Promise<Map<string, T>> {
    const m = new Map<string, T>();
    for (let i = 0; i < ids.length; i += 500) {
      const rows = await this.ok<{ id: string; data: T }[]>(this.db.from(table).select("id,data").in("id", ids.slice(i, i + 500)));
      for (const r of rows) m.set(r.id, r.data);
    }
    return m;
  }

  private async upsert(table: string, rows: Record<string, unknown>[]) {
    for (let i = 0; i < rows.length; i += 500) await this.ok(this.db.from(table).upsert(rows.slice(i, i + 500)));
  }

  async upsertWorks(works: Work[]) {
    const old = await this.existing<Work>("works", works.map((w) => w.id));
    await this.upsert(
      "works",
      works.map((w) => {
        const p = old.get(w.id);
        const m = p ? { ...w, titleAr: w.titleAr ?? p.titleAr, aliases: [...new Set([...w.aliases, ...p.aliases])] } : w;
        return { id: m.id, category: m.category, tier: m.tier, popularity: m.popularity, score: m.score ?? null, year: m.year ?? null, title: m.title, data: m, updated_at: Date.now() };
      }),
    );
  }
  async upsertCharacters(chars: Character[]) {
    const old = await this.existing<Character>("characters", chars.map((c) => c.id));
    await this.upsert("characters", chars.map((c) => ({ id: c.id, work_id: c.workId, data: mergeNames(c, old.get(c.id)) })));
  }
  async upsertPeople(people: Person[]) {
    const old = await this.existing<Person>("people", people.map((c) => c.id));
    await this.upsert("people", people.map((p) => ({ id: p.id, data: mergeNames(p, old.get(p.id)) })));
  }
  async upsertThemes(themes: Theme[]) {
    await this.upsert("themes", themes.map((t) => ({ id: t.id, work_id: t.workId, data: t })));
  }
  async upsertMedia(media: MediaAsset[]) {
    await this.upsert("media", media.map((m) => ({ id: m.id, work_id: m.workId, kind: m.kind, data: m })));
  }
  async deleteMedia(id: string) {
    await this.ok(this.db.from("media").delete().eq("id", id));
  }

  private table(kind: "work" | "character" | "person") {
    return kind === "work" ? "works" : kind === "character" ? "characters" : "people";
  }
  private async patch(kind: "work" | "character" | "person", id: string, fn: (d: Record<string, unknown>) => void) {
    const t = this.table(kind);
    const row = await this.ok<{ data: Record<string, unknown> } | null>(this.db.from(t).select("data").eq("id", id).maybeSingle());
    if (!row) throw new Error(`${kind} ${id} not found`);
    fn(row.data);
    await this.ok(this.db.from(t).update({ data: row.data }).eq("id", id));
  }
  async addAlias(kind: "work" | "character" | "person", id: string, alias: string) {
    await this.patch(kind, id, (d) => void (d.aliases = [...new Set([...((d.aliases as string[]) ?? []), alias.trim()])]));
  }
  async setArabicName(kind: "work" | "character" | "person", id: string, nameAr: string) {
    await this.patch(kind, id, (d) => void (d[kind === "work" ? "titleAr" : "nameAr"] = nameAr.trim()));
  }
  async getWork(id: string) {
    const r = await this.ok<{ data: Work } | null>(this.db.from("works").select("data").eq("id", id).maybeSingle());
    return r?.data;
  }
  async listWorks(f: WorkFilter = {}) {
    let q = this.db.from("works").select("data").order("popularity", { ascending: false });
    if (f.category) q = q.eq("category", f.category);
    if (f.tier) q = q.eq("tier", f.tier);
    if (f.search) q = q.ilike("title", `%${f.search}%`);
    const off = f.offset ?? 0;
    return (await this.ok<{ data: Work }[]>(q.range(off, off + (f.limit ?? 50) - 1))).map((r) => r.data);
  }
  async counts() {
    const c = async (t: string) => (await this.db.from(t).select("id", { count: "exact", head: true })).count ?? 0;
    return { works: await c("works"), characters: await c("characters"), people: await c("people"), themes: await c("themes"), media: await c("media") };
  }
  async coverage(): Promise<CoverageRow[]> {
    const m = new Map<string, CoverageRow>();
    for (const w of await this.all<Work>("works")) {
      const decade = w.year ? Math.floor(w.year / 10) * 10 : null;
      const genre = w.genres[0] ?? null;
      const key = `${w.category}|${w.tier}|${decade}|${genre}`;
      const row = m.get(key) ?? { category: w.category, tier: w.tier, decade, genre, count: 0 };
      row.count++;
      m.set(key, row);
    }
    return [...m.values()];
  }
  async loadLibrary(): Promise<Library> {
    const [works, characters, people, themes, media] = await Promise.all([this.all<Work>("works"), this.all<Character>("characters"), this.all<Person>("people"), this.all<Theme>("themes"), this.all<MediaAsset>("media")]);
    return { works, characters, people, themes, media };
  }

  async upsertUser(u: User) {
    const old = await this.getUser(u.id);
    const merged = { ...old, ...u, linked: { ...old?.linked, ...u.linked } };
    await this.ok(this.db.from("users").upsert({ id: u.id, data: merged, created_at: old?.createdAt ?? Date.now() }));
  }
  async getUser(id: string) {
    const r = await this.ok<{ data: User; created_at: number } | null>(this.db.from("users").select("data,created_at").eq("id", id).maybeSingle());
    return r ? { ...r.data, createdAt: Number(r.created_at) } : undefined;
  }
  async listUsers() {
    return (await this.ok<{ data: User }[]>(this.db.from("users").select("data").order("created_at"))).map((r) => r.data);
  }

  async recordAnswer(a: AnswerRecord) {
    await this.ok(
      this.db.from("answers").insert({
        user_id: a.userId, question_key: a.questionKey, mode: a.mode, work_id: a.workId, category: a.category, tier: a.tier,
        correct: a.correct ? 1 : 0, points: a.points, method: a.method, hints_used: a.hintsUsed, room_code: a.roomCode ?? null, role: a.role ?? null, at: a.at,
      }),
    );
  }
  private async answersOf(userIds?: string[]) {
    const out: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      let q = this.db.from("answers").select("*").order("at", { ascending: false }).range(from, from + 999);
      if (userIds) q = q.in("user_id", userIds);
      const rows = await this.ok<Record<string, unknown>[]>(q);
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }
  async seen(userIds: string[]) {
    const m = new Map<string, number>();
    if (!userIds.length) return m;
    for (const r of await this.answersOf(userIds)) {
      const k = r.question_key as string;
      m.set(k, Math.max(m.get(k) ?? 0, Number(r.at)));
    }
    return m;
  }
  async leaderboard(opts: { mode?: string; since?: number; roomCode?: string } = {}): Promise<LeaderRow[]> {
    const users = new Map((await this.listUsers()).map((u) => [u.id, u]));
    const agg = new Map<string, LeaderRow>();
    for (const r of await this.answersOf()) {
      if (opts.mode && r.mode !== opts.mode) continue;
      if (opts.since && Number(r.at) < opts.since) continue;
      if (opts.roomCode && r.room_code !== opts.roomCode) continue;
      const id = r.user_id as string;
      const row = agg.get(id) ?? { userId: id, name: users.get(id)?.name ?? id, points: 0, correct: 0, answers: 0 };
      row.points += Number(r.points);
      row.correct += Number(r.correct);
      row.answers++;
      agg.set(id, row);
    }
    return [...agg.values()].sort((a, b) => b.points - a.points);
  }
  async playerStats(userId: string): Promise<PlayerStats> {
    const rows = await this.answersOf([userId]);
    const g = rows.filter((r) => (r.role ?? "guesser") === "guesser");
    const by = (k: string) => {
      const m = new Map<string, { correct: number; answers: number }>();
      for (const r of g) {
        const e = m.get(r[k] as string) ?? { correct: 0, answers: 0 };
        e.correct += Number(r.correct);
        e.answers++;
        m.set(r[k] as string, e);
      }
      return [...m.entries()];
    };
    const roleP = (role: string) => rows.filter((r) => r.role === role).reduce((s, r) => s + Number(r.points), 0);
    const known = (tier: string) => new Set(rows.filter((r) => r.tier === tier && Number(r.correct)).map((r) => r.work_id)).size;
    const correct = g.reduce((s, r) => s + Number(r.correct), 0);
    return {
      userId,
      totalPoints: g.reduce((s, r) => s + Number(r.points), 0) + roleP("describer") + roleP("drawer"),
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
    const rows = (await this.answersOf(userIds)).filter((r) => (r.role ?? "guesser") === "guesser").slice(0, lastN);
    if (rows.length < 10) return null;
    return rows.reduce((s, r) => s + Number(r.correct), 0) / rows.length;
  }

  async addReport(r: Omit<Report, "id" | "status" | "at">) {
    const rep: Report = { ...r, id: crypto.randomUUID(), status: "open", at: Date.now() };
    await this.ok(this.db.from("reports").insert({ id: rep.id, user_id: rep.userId, question_key: rep.questionKey, work_id: rep.workId ?? null, reason: rep.reason, status: rep.status, at: rep.at }));
    return rep;
  }
  async listReports(status?: Report["status"]) {
    let q = this.db.from("reports").select("*").order("at", { ascending: false });
    if (status) q = q.eq("status", status);
    return (await this.ok<Record<string, unknown>[]>(q)).map((r) => ({ id: r.id as string, userId: r.user_id as string, questionKey: r.question_key as string, workId: (r.work_id as string) ?? undefined, reason: r.reason as string, status: r.status as Report["status"], at: Number(r.at) }));
  }
  async setReportStatus(id: string, status: Report["status"]) {
    await this.ok(this.db.from("reports").update({ status }).eq("id", id));
  }
  async saveDrawing(d: Drawing) {
    await this.ok(this.db.from("drawings").upsert({ id: d.id, room_code: d.roomCode, user_id: d.userId, work_id: d.workId, subject: d.subject, png: d.png, votes_best: d.votesBest, votes_funny: d.votesFunny, at: d.at }));
  }
  async voteDrawing(id: string, kind: "best" | "funny") {
    await this.ok(this.db.rpc("vote_drawing", { drawing_id: id, kind }));
  }
  private dr(r: Record<string, unknown>): Drawing {
    return { id: r.id as string, roomCode: r.room_code as string, userId: r.user_id as string, workId: r.work_id as string, subject: r.subject as string, png: r.png as string, votesBest: Number(r.votes_best), votesFunny: Number(r.votes_funny), at: Number(r.at) };
  }
  async listDrawings(roomCode?: string) {
    let q = this.db.from("drawings").select("*").order("at", { ascending: false }).limit(500);
    if (roomCode) q = q.eq("room_code", roomCode);
    return (await this.ok<Record<string, unknown>[]>(q)).map((r) => this.dr(r));
  }
  async getDrawing(id: string) {
    const r = await this.ok<Record<string, unknown> | null>(this.db.from("drawings").select("*").eq("id", id).maybeSingle());
    return r ? this.dr(r) : undefined;
  }
  async getSetting<T>(key: string) {
    const r = await this.ok<{ value: T } | null>(this.db.from("settings").select("value").eq("key", key).maybeSingle());
    return r?.value;
  }
  async setSetting<T>(key: string, value: T) {
    await this.ok(this.db.from("settings").upsert({ key, value }));
  }
  async logJob(name: string, status: string, detail?: string) {
    await this.ok(this.db.from("jobs").insert({ name, status, detail: detail ?? null, at: Date.now() }));
  }
  async listJobs(limit = 50) {
    return (await this.ok<{ name: string; status: string; detail: string | null; at: number }[]>(this.db.from("jobs").select("name,status,detail,at").order("id", { ascending: false }).limit(limit))).map((r) => ({ ...r, at: Number(r.at) }));
  }
}

function mergeNames<T extends { nameAr?: string; aliases: string[] }>(n: T, p?: T): T {
  return p ? { ...n, nameAr: n.nameAr ?? p.nameAr, aliases: [...new Set([...n.aliases, ...p.aliases])] } : n;
}
