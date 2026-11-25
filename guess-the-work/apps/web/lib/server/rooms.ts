import "server-only";
import { randomBytes } from "node:crypto";
import {
  backToLobby,
  finishGame as finishGameNow,
  becomePlayer,
  createRoom,
  kick,
  markLoaded,
  pause,
  resume,
  transferHost,
  join,
  proposeAlias,
  publicRoom,
  requestHint,
  roomCode,
  skip,
  startGuess,
  submitAnswer,
  tick,
  updateSettings,
  voteAlias,
  QUESTION_KINDS,
  OPEN_BATCH,
  appendQuestions,
  type RoomSettings,
  type RoomState,
  type Submission,
} from "@gtw/core/room";
import { generateQuestions } from "@gtw/core/generate";
import { buildSocialQuestions } from "@gtw/core/social";
import { buildSummary, titlesFor } from "@gtw/core/summary";
import { shuffle } from "@gtw/core/rng";
import { buildPackQuestions, type PackData } from "@gtw/core/packs";
import { publicQuestion, type Question } from "@gtw/core/questions";
import { adaptMix } from "@gtw/core/tiers";
import { seeded } from "@gtw/core/rng";
import type { WatchStatus } from "@gtw/core/group";
import * as describer from "@gtw/core/describer";
import * as drawer from "@gtw/core/drawer";
import * as tierlist from "@gtw/core/tierlist";
import { adjustGame, endGame, extendGame, leaveGame, newRoundReady, rememberable, tickPace, voteExtend } from "@gtw/core/pacing";
import { getLibrary, invalidateLibrary } from "./library";
import { getRepo } from "./repo";
import { assetUrl } from "./media";
import { storage } from "./storage";
import type { Session } from "./session";

/**
 * Rooms live in the database (serverless: any instance can answer). Clients poll.
 * Every read moves the room on by the clock; writes use compare-and-swap on the row version,
 * and side effects (saving answers) run only for the request whose write won.
 */
type Effects = (() => Promise<void>)[];

async function saveAnswers(s: RoomState, q: Question, answers: RoomState["answers"], hints: RoomState["hintsUsed"], fx: Effects) {
  const players = s.players.map((p) => p.id);
  const roomCode = answersRoom(s);
  const start = s.phaseStartedAt;
  fx.push(async () => {
    const repo = getRepo();
    for (const id of players) {
      const a = answers[id];
      await repo.recordAnswer({
        userId: id,
        questionKey: q.key,
        mode: q.mode,
        workId: q.workId,
        category: q.category,
        tier: q.tier,
        correct: !!a?.correct,
        points: a?.points ?? 0,
        method: a?.method ?? "text",
        hintsUsed: hints[id] ?? 0,
        roomCode,
        elapsedMs: a ? a.at - start : undefined,
        at: Date.now(),
      });
    }
  });
}

/** Runs the clock: closes questions, moves turns, feeds the describer. Returns true when something changed. */
async function advance(s: RoomState, now: number, fx: Effects): Promise<boolean> {
  let changed = false;
  for (let i = 0; i < 60; i++) {
    const before = `${s.phase}|${s.index}|${s.phaseEndsAt}`;
    tickPace(s, now);
    if (QUESTION_KINDS.includes(s.settings.kind)) {
      const q = s.questions[s.index];
      const answers = { ...s.answers };
      const hints = { ...s.hintsUsed };
      const ev = tick(s, now);
      if (ev.closed && q) await saveAnswers(s, q, answers, hints, fx);
      // «زد» / «مفتوح» / a longer remaining count: generate and append
      if (s.want && s.phase !== "finished" && s.phase !== "lobby") {
        appendQuestions(s, await makeQuestions(s, s.want, seeded(randomBytes(8).toString("hex"))), now);
        changed = true;
      }
    } else if (s.settings.kind === "tierlist") {
      tierlist.tickTier(s, now);
      if (s.want && s.phase !== "finished" && s.phase !== "lobby") {
        tierlist.appendTierItems(s, await makeTierItems(s, s.want, false), now);
        changed = true;
      }
    } else if (s.settings.kind === "describer" || s.settings.kind === "camera") {
      const ev = describer.tickDescriber(s, now);
      if (ev.needItems) {
        const lib = await getLibrary();
        describer.giveItems(s, describer.pickItems(lib, s.settings.describe.choose ? 2 : 1, { mix: s.settings.mix, rng: seeded(randomBytes(8).toString("hex")), categories: s.settings.categories }), now);
        changed = true;
      }
      if (ev.scored) saveParty(s, ev.scored, fx);
    } else {
      const ev = drawer.tickDrawer(s, now);
      if (ev.scored) saveParty(s, ev.scored, fx);
      if (ev.needItems) {
        drawer.giveRound(s, await drawItems(s), now);
        changed = true;
      }
      if (ev.voted) {
        const drawings = ev.voted;
        fx.push(async () => {
          const repo = getRepo();
          for (const d of drawings) {
            const saved = await repo.getDrawing(d.id);
            if (saved) await repo.saveDrawing({ ...saved, votesBest: d.votesBest, votesFunny: d.votesFunny });
          }
        });
      }
    }
    if (before === `${s.phase}|${s.index}|${s.phaseEndsAt}`) break;
    changed = true;
  }
  return changed;
}

/** Where a room's answers are filed: the daily tag / pack tag, else the room code (solo games each their own). */
export function answersRoom(s: RoomState) {
  return s.tag && s.tag !== "solo" ? s.tag : s.code;
}

/** Game over: the night summary goes to the archive and everybody's titles are recomputed. */
function finalize(s: RoomState, fx: Effects) {
  const room = answersRoom(s);
  const players = s.players.filter((p) => !p.spectator).map((p) => ({ id: p.id, name: p.name, score: p.score, color: p.color, avatar: p.avatar }));
  const id = `${s.code}-${s.phaseStartedAt}`;
  const kind = s.settings.kind;
  if (kind === "tierlist" && s.party) {
    const archive = tierlist.tierArchive(s);
    const ratings = tierlist.personalRatings(s);
    fx.push(async () => {
      const repo = getRepo();
      if (archive.items.length) await repo.saveSession({ id, roomCode: s.code, summary: { kind, tier: archive, players: archive.players.map((p) => ({ ...p, score: s.players.find((x) => x.id === p.id)?.score ?? 0 })) } as never, at: Date.now() });
      // each player's own tiers become ratings in their watch log (taste similarity, recommendations)
      const existing = new Map((await repo.watchAll()).map((e) => [`${e.userId}|${e.workId}`, e]));
      for (const r of ratings) {
        const e = existing.get(`${r.userId}|${r.workId}`);
        await repo.setWatch({ userId: r.userId, workId: r.workId, status: e && e.status !== "not_seen" ? e.status : "seen", rating: tierlist.TIER_RATING[r.tier], at: Date.now() });
      }
    });
    return;
  }
  fx.push(async () => {
    const repo = getRepo();
    const ids = new Set(players.map((p) => p.id));
    const answers = (await repo.answersOfRoom(room)).filter((a) => ids.has(a.userId));
    const drawings = kind === "drawer" ? (await repo.listDrawings(room)).filter((d) => ids.has(d.userId)) : [];
    const summary = buildSummary({ players, answers, drawings });
    if (summary.questions || drawings.length) await repo.saveSession({ id, roomCode: s.code, summary: { ...summary, kind }, at: Date.now() });
    const users = await repo.listUsers();
    const stats = await Promise.all(
      users.map(async (u) => {
        const st = await repo.playerStats(u.id);
        const n = st.byMode.reduce((x, m) => x + m.answers, 0);
        return { ...st, answers: n };
      }),
    );
    await repo.setSetting("titles", Object.fromEntries(titlesFor(stats)));
  });
}

function saveParty(s: RoomState, rows: describer.ScoredRow[], fx: Effects) {
  const roomCode = answersRoom(s);
  fx.push(async () => {
    const repo = getRepo();
    for (const r of rows) await repo.recordAnswer({ ...r, roomCode, at: Date.now() });
  });
}

class Busy extends Error {}

/** Read, change, write with compare-and-swap; retries when another request wrote first. */
async function mutate<T>(code: string, fn: (s: RoomState, fx: Effects, now: number) => T | Promise<T>): Promise<{ state: RoomState; result: T }> {
  const repo = getRepo();
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await repo.getRoom<RoomState>(code);
    if (!row) throw new Error("الغرفة مو موجودة");
    const s = row.state;
    const now = Date.now();
    const fx: Effects = [];
    const wasFinished = s.phase === "finished";
    await advance(s, now, fx);
    const result = await fn(s, fx, now);
    await advance(s, Date.now(), fx);
    if (!wasFinished && s.phase === "finished") finalize(s, fx);
    if (await repo.saveRoom(code, s, row.version)) {
      for (const f of fx) await f();
      return { state: s, result };
    }
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 60));
  }
  throw new Busy("الغرفة مشغولة، جرّب مرة ثانية");
}

/** The room as it is now (moved on by the clock; the move is saved if nobody beat us to it). */
async function current(code: string): Promise<RoomState | null> {
  const repo = getRepo();
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await repo.getRoom<RoomState>(code);
    if (!row) return null;
    const fx: Effects = [];
    const wasFinished = row.state.phase === "finished";
    const changed = await advance(row.state, Date.now(), fx);
    if (!changed) return row.state;
    if (!wasFinished && row.state.phase === "finished") finalize(row.state, fx);
    if (await repo.saveRoom(code, row.state, row.version)) {
      for (const f of fx) await f();
      return row.state;
    }
  }
  return (await repo.getRoom<RoomState>(code))?.state ?? null;
}

const player = (u: Session) => ({ id: u.uid, name: u.name, avatar: u.avatar, color: u.color });

export async function newRoom(user: Session, settings: Partial<RoomSettings>, tag?: string, code?: string): Promise<RoomState> {
  const repo = getRepo();
  if (Math.random() < 0.1) void repo.deleteRoomsBefore(Date.now() - 3 * 86_400_000);
  // the admin's scoring numbers (and default tier mix) for new rooms
  const scoring = await repo.getSetting<RoomSettings["scoring"]>("scoring");
  const mix = await repo.getSetting<RoomSettings["mix"]>("defaultMix");
  const withDefaults: Partial<RoomSettings> = { ...(scoring ? { scoring } : {}), ...(mix && !settings.mix ? { mix } : {}), ...settings };
  for (let i = 0; i < 10; i++) {
    const c = code ?? roomCode();
    const s = createRoom(c, player(user), withDefaults);
    s.tag = tag;
    if (await repo.saveRoom(c, s, 0)) return s;
    if (code) {
      const existing = await repo.getRoom<RoomState>(code);
      if (existing) return existing.state;
    }
  }
  throw new Error("ما قدرت أنشئ غرفة");
}

export async function roomExists(code: string) {
  return !!(await getRepo().getRoom(code.toUpperCase()));
}

export async function joinRoom(code: string, user: Session) {
  const { state } = await mutate(code.toUpperCase(), (s, _fx, now) => join(s, player(user), now));
  if (state.kicked?.includes(user.uid)) throw new Error("انطردت من هذي الغرفة");
  return state;
}

function present(s: RoomState, q: Question) {
  const exp = (Math.floor(s.createdAt / 86_400_000) + 3) * 86_400_000;
  return publicQuestion(
    q,
    (a) => assetUrl({ a, r: s.code, q: q.id, e: exp }),
    (src) => assetUrl({ a: { type: "plain", src }, e: exp }),
    s.settings.method !== "text",
  );
}

/** What this player sees. Polling clients call it every second or so. */
export async function viewRoom(code: string, uid: string) {
  const s = await current(code.toUpperCase());
  if (!s) return null;
  if (!s.players.some((p) => p.id === uid)) return null;
  // presence: refresh "last seen" at most every 8 s (a write per poll would be wasteful)
  const me = s.players.find((p) => p.id === uid)!;
  if (Date.now() - me.lastSeen > 8_000) {
    void mutate(s.code, (x, _fx, now) => {
      const p = x.players.find((y) => y.id === uid);
      if (p) p.lastSeen = now;
    }).catch(() => {});
    me.lastSeen = Date.now();
  }
  const exp = (Math.floor(s.createdAt / 86_400_000) + 3) * 86_400_000;
  const image = (src: string) => assetUrl({ a: { type: "plain", src }, e: exp });
  const view = publicRoom(s, uid, Date.now(), (q) => present(s, q), image);
  view.titles = await titlesCached();
  const priv = (r: describer.TokenReq) => assetUrl({ a: r.asset, u: r.users, e: exp });
  if (s.settings.kind === "describer" || s.settings.kind === "camera") view.party = describer.describerView(s, uid, priv, image);
  if (s.settings.kind === "drawer") view.party = drawer.drawerView(s, uid, priv, image);
  if (s.settings.kind === "tierlist") view.party = tierlist.tierView(s, uid, image, (src) => assetUrl({ a: { type: "audio", src, effect: "normal", start: 0, duration: 30 }, e: exp }));
  return view;
}

let titleCache: { at: number; v: Record<string, string[]> } | null = null;
async function titlesCached() {
  if (!titleCache || Date.now() - titleCache.at > 60_000) titleCache = { at: Date.now(), v: (await getRepo().getSetting<Record<string, string[]>>("titles")) ?? {} };
  return titleCache.v;
}

/** Room state for the media route (reveal step check). */
export async function roomForMedia(code: string): Promise<RoomState | null> {
  return (await getRepo().getRoom<RoomState>(code))?.state ?? null;
}

/** Questions for this room (start, «زد», «مفتوح»): the room's filters, minus what was already asked tonight. */
async function makeQuestions(s: RoomState, count: number, rng: () => number): Promise<Question[]> {
  const repo = getRepo();
  const lib = await getLibrary();
  const ids = s.players.map((p) => p.id);
  const st = s.settings;
  if (st.kind === "social") {
    const log = await repo.watchAll();
    const asked = new Set(s.questions.map((q) => q.key));
    return buildSocialQuestions(lib, { modes: st.socialModes?.length ? st.socialModes : ["who_watched", "guess_rating"], count: count + asked.size, players: s.players.map((p) => ({ id: p.id, name: p.name })), log, rng })
      .filter((q) => !asked.has(q.key))
      .slice(0, count);
  }
  let mix = st.mix;
  if (st.adaptive) {
    const acc = await repo.accuracy(ids);
    if (acc !== null) mix = adaptMix(mix, acc);
  }
  const daily = s.tag?.startsWith("daily:");
  const seen = daily ? undefined : await repo.seen(ids);
  // tonight's questions never come back in the same game
  for (const q of s.questions) seen?.set(q.key, Date.now());
  // the watch log: question source, group tiers, own-only, spoilers
  const users = await repo.listUsers();
  const watch = new Map<string, Map<string, WatchStatus>>();
  for (const e of await repo.watchAll()) {
    let m = watch.get(e.workId);
    if (!m) watch.set(e.workId, (m = new Map()));
    m.set(e.userId, e.status);
  }
  const group = { watch, roomPlayers: ids, groupPlayers: users.filter((u) => !u.kicked).map((u) => u.id), source: st.source ?? "any", excludeOwnOnly: !!st.excludeOwnOnly, noSpoilers: st.noSpoilers !== false, mix: st.groupMix, weight: st.groupWeight ?? 0 };
  return generateQuestions(lib, {
    group,
    years: [st.years?.[0] ?? undefined, st.years?.[1] ?? undefined],
    modes: st.modes,
    count,
    mix,
    rng,
    categories: st.categories,
    seen,
    repeatAfterDays: st.repeatAfterDays,
    effects: st.effects,
    sceneLevel: st.sceneLevel,
    timeLimitMs: st.timeLimitSec * 1000,
  });
}

/** Tier list items: the manual picks first (start), else the topic with its filters, never what is already on the board. */
async function makeTierItems(s: RoomState, count: number, first: boolean): Promise<tierlist.TierItem[]> {
  const lib = await getLibrary();
  const cfg = s.settings.tier;
  const onBoard = new Set(((s.party as tierlist.TierState | undefined)?.items ?? []).map((x) => x.id));
  if (first && cfg.source === "manual" && cfg.manual.length) {
    return cfg.manual.map((id) => tierlist.itemById(lib, id)).filter((x): x is tierlist.TierItem => !!x && !onBoard.has(x.id)).slice(0, 60);
  }
  const watch = new Map<string, Map<string, WatchStatus>>();
  for (const e of await getRepo().watchAll()) {
    let m = watch.get(e.workId);
    if (!m) watch.set(e.workId, (m = new Map()));
    m.set(e.userId, e.status);
  }
  return tierlist.tierItems(lib, cfg.topic, { count, rng: seeded(randomBytes(8).toString("hex")), exclude: first ? new Set() : onBoard, watch, players: s.players.filter((p) => !p.spectator).map((p) => p.id), source: cfg.source });
}

async function drawItems(s: RoomState) {
  const lib = await getLibrary();
  const ids = s.players.filter((p) => !p.spectator).map((p) => p.id);
  const seen = await getRepo().seen(ids);
  return drawer.pickDrawItems(lib, ids.length * (s.settings.draw.choose ? 2 : 1), { mix: s.settings.mix, rng: seeded(randomBytes(8).toString("hex")), seen, categories: s.settings.categories });
}

async function start(s: RoomState, uid: string, now: number, fx?: Effects) {
  if (uid !== s.hostId) throw new Error("only the host");
  const repo = getRepo();
  const st = s.settings;
  const daily = s.tag?.startsWith("daily:");
  const rng = daily ? seeded(s.tag!) : seeded(randomBytes(8).toString("hex"));
  s.questions = [];
  // the host's last length / time choice for this mode
  if (!s.tag) {
    const key = `pace:${uid}:${st.kind}`;
    const remembered = rememberable(st);
    fx?.push(() => repo.setSetting(key, remembered));
  }
  if (st.kind === "social") {
    const qs = await makeQuestions(s, st.count, rng);
    if (!qs.length) throw new Error("ما فيه أسئلة اجتماعية: سجّلوا أعمال وقيّموها في «سجلّي» أول");
    startGuess(s, uid, qs, now);
  } else if (st.kind === "pack") {
    const lib = await getLibrary();
    const pack = st.packId ? await repo.getPack(st.packId) : undefined;
    if (!pack) throw new Error("الباقة مو موجودة");
    const qs = buildPackQuestions(lib, pack.data as PackData, rng);
    if (!qs.length) throw new Error("الباقة فاضية");
    s.tag = `pack:${pack.id}`;
    startGuess(s, uid, qs, now);
  } else if (st.kind === "guess") {
    const qs = await makeQuestions(s, st.pace?.open ? OPEN_BATCH * 2 : st.count, rng);
    if (!qs.length) throw new Error("ما فيه أسئلة لهذا الطور في المكتبة الحين. جرّب طور ثاني.");
    startGuess(s, uid, qs, now);
  } else if (st.kind === "tierlist") {
    tierlist.startTierlist(s, uid, await makeTierItems(s, Math.max(1, st.count), true), now);
  } else if (st.kind === "describer" || st.kind === "camera") {
    describer.startDescriber(s, uid, now);
  } else {
    drawer.startDrawer(s, uid, await drawItems(s), now);
  }
}

export async function createAndStart(user: Session, settings: Partial<RoomSettings>, tag?: string, code?: string) {
  const s = await newRoom(user, settings, tag, code);
  if (s.phase === "lobby") await mutate(s.code, (x, fx, now) => start(x, user.uid, now, fx));
  return s;
}

export type RoomAction =
  | { type: "answer"; submission: Submission }
  | { type: "hint" }
  | { type: "skip" }
  | { type: "start" }
  | { type: "lobby" }
  | { type: "settings"; settings: Partial<RoomSettings> }
  | { type: "chat"; text: string }
  | { type: "describe_choose"; index: number }
  | { type: "describe_skip" }
  | { type: "draw_choose"; index: number }
  | { type: "draw_submit"; png: string }
  | { type: "draw_vote"; drawingId: string; kind: "best" | "funny" }
  | { type: "alias_propose"; text: string }
  | { type: "alias_vote"; yes: boolean }
  | { type: "loaded"; questionId: string }
  | { type: "kick"; playerId: string }
  | { type: "transfer"; playerId: string }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "play" }
  | { type: "camera_ready" }
  | { type: "camera_none" }
  | { type: "camera_choice"; choice: "talk" | "skip" | "back" }
  | { type: "report_violation" }
  | { type: "approve_report"; id: number; approve: boolean }
  | { type: "revenge"; players: string[] }
  | { type: "extend"; n: number }
  | { type: "end" }
  | { type: "adjust"; sec?: number; remaining?: number }
  | { type: "vote_extend"; yes: boolean }
  | { type: "leave" }
  | { type: "new_round" }
  | { type: "tier_vote"; tier: tierlist.TierRow }
  | { type: "tier_move"; tier: tierlist.TierRow }
  | { type: "tier_agree" }
  | { type: "tier_pin"; tier?: tierlist.TierRow }
  | { type: "tier_place"; itemId: string; place: tierlist.Placement | null }
  | { type: "tier_submit" }
  | { type: "tier_continue" };

export async function act(code: string, user: Session, a: RoomAction): Promise<unknown> {
  // the PNG is stored before the room write (it may retry)
  let drawingId: string | undefined;
  if (a.type === "draw_submit") drawingId = await saveDrawingPng(code, user, a.png);
  const { result } = await mutate(code.toUpperCase(), async (s, fx, now) => {
    if (!s.players.some((p) => p.id === user.uid)) throw new Error("not in the room");
    switch (a.type) {
      case "answer":
        if (QUESTION_KINDS.includes(s.settings.kind)) return submitAnswer(s, user.uid, a.submission, now);
        if (s.settings.kind === "describer" || s.settings.kind === "camera") return describer.guess(s, user.uid, a.submission.text ?? "", now);
        return drawer.guess(s, user.uid, a.submission.text ?? "", now);
      case "hint":
        return { open: requestHint(s, user.uid, now) };
      case "loaded":
        markLoaded(s, user.uid, a.questionId, now);
        return { ok: true };
      case "kick":
        kick(s, user.uid, a.playerId, now);
        return { ok: true };
      case "transfer":
        transferHost(s, user.uid, a.playerId, now);
        return { ok: true };
      case "pause":
        pause(s, user.uid, now);
        return { ok: true };
      case "resume":
        resume(s, user.uid, now);
        return { ok: true };
      case "play":
        becomePlayer(s, user.uid);
        return { ok: true };
      case "camera_ready":
        describer.cameraReady(s, user.uid, now);
        return { ok: true };
      case "camera_none":
        describer.noCamera(s, user.uid, now);
        return { ok: true };
      case "camera_choice":
        describer.cameraChoice(s, user.uid, a.choice, now);
        return { ok: true };
      case "report_violation":
        return { id: describer.reportViolation(s, user.uid, now) };
      case "revenge": {
        // «ثأر»: the same questions in another order, only for the chosen players
        if (user.uid !== s.hostId || s.phase !== "finished" || !QUESTION_KINDS.includes(s.settings.kind)) throw new Error("only the host, at the end");
        const chosen = s.players.filter((p) => a.players.includes(p.id) || p.id === user.uid);
        if (chosen.length < 2) throw new Error("اختر لاعب على الأقل");
        const next = createRoom(roomCode(), { id: user.uid, name: user.name, avatar: user.avatar, color: user.color }, s.settings, now);
        for (const p of chosen) if (p.id !== user.uid) join(next, { id: p.id, name: p.name, avatar: p.avatar, color: p.color }, now);
        next.tag = s.tag === "solo" ? undefined : s.tag?.startsWith("pack:") ? s.tag : undefined;
        startGuess(next, user.uid, shuffle(s.questions, Math.random), now);
        next.players.forEach((p) => (p.lastSeen = now));
        if (!(await getRepo().saveRoom(next.code, next, 0))) throw new Error("try again");
        s.revenge = { code: next.code, players: chosen.map((p) => p.id) };
        return { code: next.code };
      }
      case "approve_report":
        describer.approveReport(s, user.uid, a.id, a.approve);
        return { ok: true };
      case "skip":
        skip(s, user.uid, now);
        return { ok: true };
      case "start":
        await start(s, user.uid, now, fx);
        return { ok: true };
      case "extend":
        extendGame(s, user.uid, a.n, now);
        return { ok: true };
      case "end":
        endGame(s, user.uid, now);
        return { ok: true };
      case "adjust":
        adjustGame(s, user.uid, { sec: a.sec, remaining: a.remaining }, now);
        return { ok: true };
      case "vote_extend":
        voteExtend(s, user.uid, a.yes, now);
        return { ok: true };
      case "leave":
        leaveGame(s, user.uid, now);
        return { ok: true };
      case "tier_vote":
        tierlist.voteTier(s, user.uid, a.tier, now);
        return { ok: true };
      case "tier_move":
        tierlist.moveTier(s, user.uid, a.tier, now);
        return { ok: true };
      case "tier_agree":
        tierlist.agreeTier(s, user.uid, now);
        return { ok: true };
      case "tier_pin":
        tierlist.pinTier(s, user.uid, a.tier, now);
        return { ok: true };
      case "tier_place":
        tierlist.placeBoard(s, user.uid, a.itemId, a.place);
        return { ok: true };
      case "tier_submit":
        tierlist.submitBoard(s, user.uid, now);
        return { ok: true };
      case "tier_continue":
        tierlist.continueTier(s, user.uid, now);
        return { ok: true };
      case "new_round": {
        // «جولة جديدة بنفس الإعدادات»: tonight's summary keeps this round, then a fresh one
        if (!newRoundReady(s, user.uid)) throw new Error("only the host, at the end");
        if (s.settings.kind === "pack") throw new Error("الباقة أسئلتها ثابتة");
        if (s.phase !== "finished") {
          finishGameNow(s, now);
          finalize(s, fx);
        }
        backToLobby(s, user.uid, now);
        for (const p of s.players) p.spectator = undefined;
        await start(s, user.uid, now + 1, fx);
        return { ok: true };
      }
      case "lobby":
        backToLobby(s, user.uid, now);
        return { ok: true };
      case "settings": {
        const { scoring: _ignored, ...rest } = a.settings;
        void _ignored;
        updateSettings(s, user.uid, rest);
        return { ok: true };
      }
      case "chat": {
        const text = a.text.slice(0, 300).trim();
        if (!text) return { ok: true };
        if (s.settings.kind === "describer" || s.settings.kind === "camera") return describer.chat(s, user.uid, text, now);
        if (s.settings.kind === "drawer" && s.phase === "draw_guess") return drawer.guess(s, user.uid, text, now);
        s.chat.push({ id: (s.chat.at(-1)?.id ?? 0) + 1, at: now, playerId: user.uid, text, kind: "chat" });
        if (s.chat.length > 300) s.chat.splice(0, s.chat.length - 300);
        return { ok: true };
      }
      case "describe_choose":
        describer.choose(s, user.uid, a.index, now);
        return { ok: true };
      case "describe_skip":
        if (describer.skipItem(s, user.uid)) {
          const lib = await getLibrary();
          describer.giveItems(s, describer.pickItems(lib, s.settings.describe.choose ? 2 : 1, { mix: s.settings.mix, rng: seeded(randomBytes(8).toString("hex")), categories: s.settings.categories }), now);
        }
        return { ok: true };
      case "draw_choose":
        drawer.choose(s, user.uid, a.index);
        return { ok: true };
      case "draw_submit":
        drawer.submit(s, user.uid, drawingId!, now);
        return { ok: true };
      case "draw_vote":
        drawer.vote(s, user.uid, a.drawingId, a.kind);
        return { ok: true };
      case "alias_propose":
        return { ok: proposeAlias(s, user.uid, a.text, now) };
      case "alias_vote": {
        const v = voteAlias(s, user.uid, a.yes, now);
        const q = v && s.questions.find((x) => x.id === v.questionId);
        if (v && q?.entity) {
          const { kind, id } = q.entity;
          const text = v.text;
          fx.push(async () => {
            await getRepo().addAlias(kind, id, text);
            invalidateLibrary();
          });
        }
        return { ok: true };
      }
    }
  });
  return result;
}

async function saveDrawingPng(code: string, user: Session, dataUrl: string): Promise<string> {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error("bad png");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 3_000_000) throw new Error("الرسمة كبيرة");
  const id = randomBytes(10).toString("hex");
  await storage().put(`media/drawings/${id}.png`, buf, "image/png");
  const s = await roomForMedia(code.toUpperCase());
  const item = s ? drawer.itemOf(s, user.uid) : undefined;
  await getRepo().saveDrawing({ id, roomCode: s?.tag ?? code, userId: user.uid, workId: item?.workId ?? "", subject: item?.display.title ?? "", png: `drawings/${id}.png`, votesBest: 0, votesFunny: 0, at: Date.now() });
  return id;
}
