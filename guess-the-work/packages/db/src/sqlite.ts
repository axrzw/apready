import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SQLITE_SCHEMA } from "./schema";
import type { Character, MediaAsset, Person, Theme, Work } from "@gtw/core/types";
import type { Library } from "@gtw/core/library";
import type { AnswerRecord, CoverageRow, Drawing, LeaderRow, PlayerStats, Report, Repo, User, WorkFilter } from "./repo";

type Row = Record<string, unknown>;

function uniq(a: string[]): string[] {
  return [...new Set(a.filter(Boolean))];
}

export class SqliteRepo implements Repo {
  db: DatabaseSync;

  constructor(path: string, migrationSql: string = SQLITE_SCHEMA) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("pragma journal_mode = wal; pragma synchronous = normal;");
    this.db.exec(migrationSql);
  }

  private tx(fn: () => void) {
    this.db.exec("begin");
    try {
      fn();
      this.db.exec("commit");
    } catch (e) {
      this.db.exec("rollback");
      throw e;
    }
  }

  async upsertWorks(works: Work[]) {
    const st = this.db.prepare(
      `insert into works (id, category, tier, popularity, score, year, title, data, updated_at) values (?,?,?,?,?,?,?,?,?)
       on conflict(id) do update set category=excluded.category, tier=excluded.tier, popularity=excluded.popularity,
       score=excluded.score, year=excluded.year, title=excluded.title, data=excluded.data, updated_at=excluded.updated_at`,
    );
    const get = this.db.prepare("select data from works where id = ?");
    this.tx(() => {
      for (const w of works) {
        // keep names added by hand (Arabic, dub names, voted aliases)
        const old = get.get(w.id) as Row | undefined;
        let merged = w;
        if (old) {
          const prev = JSON.parse(old.data as string) as Work;
          merged = { ...w, titleAr: w.titleAr ?? prev.titleAr, aliases: uniq([...w.aliases, ...prev.aliases]) };
        }
        st.run(merged.id, merged.category, merged.tier, merged.popularity, merged.score ?? null, merged.year ?? null, merged.title, JSON.stringify(merged), Date.now());
      }
    });
  }

  private upsertJson(table: string, cols: string[], rows: { id: string; data: unknown; extra: unknown[] }[]) {
    const st = this.db.prepare(
      `insert into ${table} (id, ${cols.join(", ")}${cols.length ? ", " : ""}data) values (?, ${cols.map(() => "?, ").join("")}?)
       on conflict(id) do update set ${cols.map((c) => `${c}=excluded.${c}, `).join("")}data=excluded.data`,
    );
    this.tx(() => {
      for (const r of rows) st.run(r.id, ...(r.extra as (string | number | null)[]), JSON.stringify(r.data));
    });
  }

  private mergeNames<T extends { id: string; nameAr?: string; aliases: string[] }>(table: string, items: T[]): T[] {
    const get = this.db.prepare(`select data from ${table} where id = ?`);
    return items.map((it) => {
      const old = get.get(it.id) as Row | undefined;
      if (!old) return it;
      const prev = JSON.parse(old.data as string) as T;
      return { ...it, nameAr: it.nameAr ?? prev.nameAr, aliases: uniq([...it.aliases, ...prev.aliases]) };
    });
  }

  async upsertCharacters(chars: Character[]) {
    this.upsertJson("characters", ["work_id"], this.mergeNames("characters", chars).map((c) => ({ id: c.id, data: c, extra: [c.workId] })));
  }
  async upsertPeople(people: Person[]) {
    this.upsertJson("people", [], this.mergeNames("people", people).map((p) => ({ id: p.id, data: p, extra: [] })));
  }
  async upsertThemes(themes: Theme[]) {
    this.upsertJson("themes", ["work_id"], themes.map((t) => ({ id: t.id, data: t, extra: [t.workId] })));
  }
  async upsertMedia(media: MediaAsset[]) {
    this.upsertJson("media", ["work_id", "kind"], media.map((m) => ({ id: m.id, data: m, extra: [m.workId, m.kind] })));
  }
  async deleteMedia(id: string) {
    this.db.prepare("delete from media where id = ?").run(id);
  }

  private table(kind: "work" | "character" | "person") {
    return kind === "work" ? "works" : kind === "character" ? "characters" : "people";
  }

  async addAlias(kind: "work" | "character" | "person", id: string, alias: string) {
    const t = this.table(kind);
    const row = this.db.prepare(`select data from ${t} where id = ?`).get(id) as Row | undefined;
    if (!row) throw new Error(`${kind} ${id} not found`);
    const obj = JSON.parse(row.data as string) as { aliases: string[] };
    obj.aliases = uniq([...obj.aliases, alias.trim()]);
    this.db.prepare(`update ${t} set data = ? where id = ?`).run(JSON.stringify(obj), id);
  }

  async setArabicName(kind: "work" | "character" | "person", id: string, nameAr: string) {
    const t = this.table(kind);
    const row = this.db.prepare(`select data from ${t} where id = ?`).get(id) as Row | undefined;
    if (!row) throw new Error(`${kind} ${id} not found`);
    const obj = JSON.parse(row.data as string) as Record<string, unknown>;
    obj[kind === "work" ? "titleAr" : "nameAr"] = nameAr.trim();
    this.db.prepare(`update ${t} set data = ? where id = ?`).run(JSON.stringify(obj), id);
  }

  async getWork(id: string) {
    const r = this.db.prepare("select data from works where id = ?").get(id) as Row | undefined;
    return r ? (JSON.parse(r.data as string) as Work) : undefined;
  }

  async listWorks(f: WorkFilter = {}) {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.category) (where.push("category = ?"), args.push(f.category));
    if (f.tier) (where.push("tier = ?"), args.push(f.tier));
    if (f.search) (where.push("(title like ? or data like ?)"), args.push(`%${f.search}%`, `%${f.search}%`));
    const sql = `select data from works ${where.length ? "where " + where.join(" and ") : ""} order by popularity desc limit ? offset ?`;
    return (this.db.prepare(sql).all(...args, f.limit ?? 50, f.offset ?? 0) as Row[]).map((r) => JSON.parse(r.data as string) as Work);
  }

  async counts() {
    const c = (t: string) => Number((this.db.prepare(`select count(*) n from ${t}`).get() as Row).n);
    return { works: c("works"), characters: c("characters"), people: c("people"), themes: c("themes"), media: c("media") };
  }

  async coverage(): Promise<CoverageRow[]> {
    const rows = this.db.prepare("select category, tier, year, data from works").all() as Row[];
    const m = new Map<string, CoverageRow>();
    for (const r of rows) {
      const w = JSON.parse(r.data as string) as Work;
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
    const all = <T>(t: string) => (this.db.prepare(`select data from ${t}`).all() as Row[]).map((r) => JSON.parse(r.data as string) as T);
    return { works: all<Work>("works"), characters: all<Character>("characters"), people: all<Person>("people"), themes: all<Theme>("themes"), media: all<MediaAsset>("media") };
  }

  async upsertUser(u: User) {
    const old = await this.getUser(u.id);
    const merged = { ...old, ...u, linked: { ...old?.linked, ...u.linked } };
    this.db
      .prepare("insert into users (id, data, created_at) values (?,?,?) on conflict(id) do update set data = excluded.data")
      .run(u.id, JSON.stringify(merged), old?.createdAt ?? Date.now());
  }
  async getUser(id: string) {
    const r = this.db.prepare("select data, created_at from users where id = ?").get(id) as Row | undefined;
    return r ? ({ ...(JSON.parse(r.data as string) as User), createdAt: Number(r.created_at) }) : undefined;
  }
  async listUsers() {
    return (this.db.prepare("select data from users order by created_at").all() as Row[]).map((r) => JSON.parse(r.data as string) as User);
  }

  async recordAnswer(a: AnswerRecord) {
    this.db
      .prepare(
        "insert into answers (user_id, question_key, mode, work_id, category, tier, correct, points, method, hints_used, room_code, role, at) values (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(a.userId, a.questionKey, a.mode, a.workId, a.category, a.tier, a.correct ? 1 : 0, a.points, a.method, a.hintsUsed, a.roomCode ?? null, a.role ?? null, a.at);
  }

  async seen(userIds: string[]) {
    const m = new Map<string, number>();
    if (!userIds.length) return m;
    const rows = this.db
      .prepare(`select question_key k, max(at) t from answers where user_id in (${userIds.map(() => "?").join(",")}) group by question_key`)
      .all(...userIds) as Row[];
    for (const r of rows) m.set(r.k as string, Number(r.t));
    return m;
  }

  async leaderboard(opts: { mode?: string; since?: number; roomCode?: string } = {}): Promise<LeaderRow[]> {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.roomCode) (where.push("room_code = ?"), args.push(opts.roomCode));
    if (opts.mode) (where.push("mode = ?"), args.push(opts.mode));
    if (opts.since) (where.push("at >= ?"), args.push(opts.since));
    const rows = this.db
      .prepare(
        `select user_id, sum(points) p, sum(correct) c, count(*) n from answers ${where.length ? "where " + where.join(" and ") : ""} group by user_id order by p desc`,
      )
      .all(...args) as Row[];
    const users = new Map((await this.listUsers()).map((u) => [u.id, u]));
    return rows.map((r) => ({ userId: r.user_id as string, name: users.get(r.user_id as string)?.name ?? (r.user_id as string), points: Number(r.p), correct: Number(r.c), answers: Number(r.n) }));
  }

  async playerStats(userId: string): Promise<PlayerStats> {
    const one = (sql: string) => this.db.prepare(sql).get(userId) as Row;
    const t = one("select coalesce(sum(points),0) p, coalesce(sum(correct),0) c, count(*) n from answers where user_id = ? and coalesce(role,'guesser') = 'guesser'");
    const by = (col: string) =>
      (this.db.prepare(`select ${col} k, sum(correct) c, count(*) n from answers where user_id = ? and coalesce(role,'guesser')='guesser' group by ${col}`).all(userId) as Row[]).map((r) => ({
        k: r.k as string,
        correct: Number(r.c),
        answers: Number(r.n),
      }));
    const roleP = (role: string) => Number((this.db.prepare("select coalesce(sum(points),0) p from answers where user_id = ? and role = ?").get(userId, role) as Row).p);
    const known = (tier: string) => Number((this.db.prepare("select count(distinct work_id) n from answers where user_id = ? and correct = 1 and tier = ?").get(userId, tier) as Row).n);
    return {
      userId,
      totalPoints: Number(t.p) + roleP("describer") + roleP("drawer"),
      accuracy: Number(t.n) ? Number(t.c) / Number(t.n) : 0,
      byCategory: by("category").map(({ k, ...r }) => ({ category: k, ...r })),
      byMode: by("mode").map(({ k, ...r }) => ({ mode: k, ...r })),
      hiddenGemsKnown: known("hidden_gem"),
      obscureKnown: known("obscure"),
      describerPoints: roleP("describer"),
      drawerPoints: roleP("drawer"),
    };
  }

  async accuracy(userIds: string[], lastN = 50) {
    if (!userIds.length) return null;
    const rows = this.db
      .prepare(`select correct from answers where user_id in (${userIds.map(() => "?").join(",")}) and coalesce(role,'guesser')='guesser' order by at desc limit ?`)
      .all(...userIds, lastN) as Row[];
    if (rows.length < 10) return null;
    return rows.reduce((s, r) => s + Number(r.correct), 0) / rows.length;
  }

  async addReport(r: Omit<Report, "id" | "status" | "at">) {
    const rep: Report = { ...r, id: crypto.randomUUID(), status: "open", at: Date.now() };
    this.db.prepare("insert into reports values (?,?,?,?,?,?,?)").run(rep.id, rep.userId, rep.questionKey, rep.workId ?? null, rep.reason, rep.status, rep.at);
    return rep;
  }
  async listReports(status?: Report["status"]) {
    const rows = (status ? this.db.prepare("select * from reports where status = ? order by at desc").all(status) : this.db.prepare("select * from reports order by at desc").all()) as Row[];
    return rows.map((r) => ({ id: r.id as string, userId: r.user_id as string, questionKey: r.question_key as string, workId: (r.work_id as string) ?? undefined, reason: r.reason as string, status: r.status as Report["status"], at: Number(r.at) }));
  }
  async setReportStatus(id: string, status: Report["status"]) {
    this.db.prepare("update reports set status = ? where id = ?").run(status, id);
  }

  async saveDrawing(d: Drawing) {
    this.db.prepare("insert or replace into drawings values (?,?,?,?,?,?,?,?,?)").run(d.id, d.roomCode, d.userId, d.workId, d.subject, d.png, d.votesBest, d.votesFunny, d.at);
  }
  async voteDrawing(id: string, kind: "best" | "funny") {
    this.db.prepare(`update drawings set ${kind === "best" ? "votes_best = votes_best + 1" : "votes_funny = votes_funny + 1"} where id = ?`).run(id);
  }
  private drawingRow(r: Row): Drawing {
    return { id: r.id as string, roomCode: r.room_code as string, userId: r.user_id as string, workId: r.work_id as string, subject: r.subject as string, png: r.png as string, votesBest: Number(r.votes_best), votesFunny: Number(r.votes_funny), at: Number(r.at) };
  }
  async listDrawings(roomCode?: string) {
    const rows = (roomCode ? this.db.prepare("select * from drawings where room_code = ? order by at desc").all(roomCode) : this.db.prepare("select * from drawings order by at desc limit 500").all()) as Row[];
    return rows.map((r) => this.drawingRow(r));
  }
  async getDrawing(id: string) {
    const r = this.db.prepare("select * from drawings where id = ?").get(id) as Row | undefined;
    return r ? this.drawingRow(r) : undefined;
  }

  async getSetting<T>(key: string) {
    const r = this.db.prepare("select value from settings where key = ?").get(key) as Row | undefined;
    return r ? (JSON.parse(r.value as string) as T) : undefined;
  }
  async setSetting<T>(key: string, value: T) {
    this.db.prepare("insert into settings values (?,?) on conflict(key) do update set value = excluded.value").run(key, JSON.stringify(value));
  }
  async logJob(name: string, status: string, detail?: string) {
    this.db.prepare("insert into jobs (name, status, detail, at) values (?,?,?,?)").run(name, status, detail ?? null, Date.now());
  }
  async listJobs(limit = 50) {
    return (this.db.prepare("select name, status, detail, at from jobs order by id desc limit ?").all(limit) as Row[]).map((r) => ({
      name: r.name as string,
      status: r.status as string,
      detail: (r.detail as string) ?? null,
      at: Number(r.at),
    }));
  }
}
