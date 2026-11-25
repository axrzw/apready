import "server-only";
import { randomBytes } from "node:crypto";
import {
  backToLobby,
  createRoom,
  proposeAlias,
  voteAlias,
  join,
  publicRoom,
  requestHint,
  roomCode,
  skip,
  startGuess,
  submitAnswer,
  systemMsg,
  tick,
  updateSettings,
  type RoomSettings,
  type RoomState,
  type Submission,
} from "@gtw/core/room";
import { generateQuestions } from "@gtw/core/generate";
import { publicQuestion, type PublicQuestion, type Question } from "@gtw/core/questions";
import { revealStep } from "@gtw/core/effects";
import { adaptMix } from "@gtw/core/tiers";
import { seeded } from "@gtw/core/rng";
import * as describer from "@gtw/core/describer";
import * as drawer from "@gtw/core/drawer";
import { getLibrary, invalidateLibrary } from "./library";
import { getRepo } from "./repo";
import { getBus } from "./bus";
import { assetUrl } from "./media";
import type { Session } from "./session";

interface Live {
  state: RoomState;
  /** question id -> public question with tokens (same URLs for everybody) */
  presented: Map<string, PublicQuestion>;
  images: Map<string, string>;
  lastPhase: string;
  touched: number;
}

const g = globalThis as unknown as { __gtwRooms?: Map<string, Live>; __gtwTicker?: NodeJS.Timeout };
const rooms = (g.__gtwRooms ??= new Map());

function publish(code: string) {
  getBus().publish(code, "update");
}

/** One clock for every room: phases move on even if nobody sends anything. */
if (!g.__gtwTicker) {
  g.__gtwTicker = setInterval(() => {
    const now = Date.now();
    for (const [code, live] of rooms) {
      if (now - live.touched > 6 * 3600_000) {
        rooms.delete(code);
        continue;
      }
      void advance(live, now);
    }
  }, 500);
  g.__gtwTicker.unref?.();
}

async function advance(live: Live, now: number) {
  const s = live.state;
  let changed = false;
  if (s.settings.kind === "guess") {
    const ev = tick(s, now);
    if (ev.closed) {
      changed = true;
      await saveAnswers(s, ev.closed.question, ev.closed.answers);
    }
  } else if (s.settings.kind === "describer") {
    const ev = describer.tickDescriber(s, now);
    changed = !!ev.changed;
    if (ev.needItems) await feedDescriber(live);
    if (ev.scored) await saveParty(s, ev.scored);
  } else {
    const ev = drawer.tickDrawer(s, now);
    changed = !!ev.changed;
    if (ev.scored) await saveParty(s, ev.scored);
    if (ev.finished) await saveDrawingsVotes(s);
  }
  if (changed || s.phase !== live.lastPhase) {
    live.lastPhase = s.phase;
    publish(s.code);
  }
}

async function saveAnswers(s: RoomState, q: Question, answers: RoomState["answers"]) {
  const repo = getRepo();
  for (const p of s.players) {
    const a = answers[p.id];
    await repo.recordAnswer({
      userId: p.id,
      questionKey: q.key,
      mode: q.mode,
      workId: q.workId,
      category: q.category,
      tier: q.tier,
      correct: !!a?.correct,
      points: a?.points ?? 0,
      method: a?.method ?? "text",
      hintsUsed: s.hintsUsed[p.id] ?? 0,
      roomCode: s.tag ?? s.code,
      at: Date.now(),
    });
  }
}

async function saveParty(s: RoomState, scored: describer.ScoredRow[]) {
  const repo = getRepo();
  for (const r of scored) await repo.recordAnswer({ ...r, roomCode: s.tag ?? s.code, at: Date.now() });
}

async function saveDrawingsVotes(s: RoomState) {
  const repo = getRepo();
  for (const d of drawer.drawingsOf(s)) {
    const saved = await repo.getDrawing(d.id);
    if (saved) await repo.saveDrawing({ ...saved, votesBest: d.votesBest, votesFunny: d.votesFunny });
  }
}

function presentFor(live: Live, q: Question): PublicQuestion {
  let p = live.presented.get(q.id);
  if (!p) {
    const s = live.state;
    const allowedStep = (steps: number) => () => {
      const cur = s.questions[s.index];
      if (cur?.id !== q.id || s.phase !== "question") return steps - 1;
      return revealStep(Date.now() - s.phaseStartedAt, s.phaseEndsAt - s.phaseStartedAt, steps);
    };
    p = publicQuestion(
      q,
      (a) => assetUrl({ asset: a, allowedStep: a.type === "image" ? allowedStep(a.steps) : undefined }),
      (src) => imageFor(live, src),
      s.settings.method !== "text",
    );
    live.presented.set(q.id, p);
  }
  return p;
}

function imageFor(live: Live, src: string): string {
  let u = live.images.get(src);
  if (!u) {
    u = assetUrl({ asset: { type: "plain", src } });
    live.images.set(src, u);
  }
  return u;
}

function wrap(state: RoomState): Live {
  const live: Live = { state, presented: new Map(), images: new Map(), lastPhase: state.phase, touched: Date.now() };
  rooms.set(state.code, live);
  return live;
}

export function getLive(code: string): Live | undefined {
  const l = rooms.get(code.toUpperCase()) ?? rooms.get(code);
  if (l) l.touched = Date.now();
  return l;
}

export function newRoom(user: Session, settings: Partial<RoomSettings>, tag?: string, code?: string): RoomState {
  let c = code ?? roomCode();
  while (!code && rooms.has(c)) c = roomCode();
  const s = createRoom(c, { id: user.uid, name: user.name, avatar: user.avatar, color: user.color }, settings);
  s.tag = tag;
  wrap(s);
  return s;
}

export function joinRoom(code: string, user: Session) {
  const live = getLive(code);
  if (!live) throw new Error("الغرفة مو موجودة");
  join(live.state, { id: user.uid, name: user.name, avatar: user.avatar, color: user.color });
  publish(live.state.code);
  return live.state;
}

export function viewRoom(code: string, uid: string) {
  const live = getLive(code);
  if (!live) return null;
  const s = live.state;
  const me = s.players.find((p) => p.id === uid);
  if (!me) return null;
  me.lastSeen = Date.now();
  const view = publicRoom(s, uid, Date.now(), (q) => presentFor(live, q), (src) => imageFor(live, src));
  if (s.settings.kind === "describer") view.party = describer.describerView(s, uid, (a) => assetUrl({ ...a, users: a.users }), (src) => imageFor(live, src));
  if (s.settings.kind === "drawer") view.party = drawer.drawerView(s, uid, (a) => assetUrl({ ...a, users: a.users }), (src) => imageFor(live, src));
  return view;
}

/** Generates the questions with the tier mix (adapted to the group), skipping what the players saw recently. */
export async function startRoom(code: string, uid: string) {
  const live = getLive(code);
  if (!live) throw new Error("no room");
  const s = live.state;
  if (uid !== s.hostId) throw new Error("only the host");
  const repo = getRepo();
  const lib = await getLibrary();
  const ids = s.players.map((p) => p.id);
  let mix = s.settings.mix;
  if (s.settings.adaptive) {
    const acc = await repo.accuracy(ids);
    if (acc !== null) mix = adaptMix(mix, acc);
  }
  const seen = await repo.seen(ids);
  const daily = s.tag?.startsWith("daily:");
  const rng = daily ? seeded(s.tag!) : seeded(randomBytes(8).toString("hex"));
  if (s.settings.kind === "guess") {
    const qs = generateQuestions(lib, {
      modes: s.settings.modes,
      count: s.settings.count,
      mix,
      rng,
      categories: s.settings.categories,
      seen: daily ? undefined : seen,
      repeatAfterDays: s.settings.repeatAfterDays,
      effects: s.settings.effects,
      sceneLevel: s.settings.sceneLevel,
      timeLimitMs: s.settings.timeLimitSec * 1000,
    });
    if (!qs.length) throw new Error("ما فيه أسئلة لهذا الطور في المكتبة الحين (جرّب طور ثاني أو شغّل السحب)");
    live.presented.clear();
    startGuess(s, uid, qs);
  } else if (s.settings.kind === "describer") {
    describer.startDescriber(s, uid, Date.now());
    await feedDescriber(live, mix, seen);
  } else {
    const items = drawer.pickDrawItems(lib, s.players.length * (s.settings.draw.choose ? 2 : 1), { mix, rng, seen, categories: s.settings.categories });
    drawer.startDrawer(s, uid, items, Date.now());
  }
  publish(s.code);
}

async function feedDescriber(live: Live, mix = live.state.settings.mix, seen?: Map<string, number>) {
  const s = live.state;
  const lib = await getLibrary();
  const items = describer.pickItems(lib, s.settings.describe.choose ? 2 : 1, { mix, rng: seeded(randomBytes(8).toString("hex")), seen, categories: s.settings.categories });
  describer.giveItems(s, items, Date.now());
  publish(s.code);
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
  | { type: "alias_vote"; yes: boolean };

export async function act(code: string, user: Session, a: RoomAction): Promise<unknown> {
  const live = getLive(code);
  if (!live) throw new Error("no room");
  const s = live.state;
  if (!s.players.some((p) => p.id === user.uid)) throw new Error("not in the room");
  let result: unknown = { ok: true };
  switch (a.type) {
    case "answer":
      if (s.settings.kind === "guess") result = submitAnswer(s, user.uid, a.submission);
      else if (s.settings.kind === "describer") result = describer.guess(s, user.uid, a.submission.text ?? "", Date.now());
      else result = drawer.guess(s, user.uid, a.submission.text ?? "", Date.now());
      break;
    case "hint":
      result = { open: requestHint(s, user.uid) };
      break;
    case "skip":
      skip(s, user.uid);
      break;
    case "start":
      await startRoom(code, user.uid);
      break;
    case "lobby":
      backToLobby(s, user.uid);
      break;
    case "settings":
      updateSettings(s, user.uid, a.settings);
      break;
    case "chat": {
      const text = a.text.slice(0, 300).trim();
      if (!text) break;
      if (s.settings.kind === "describer") result = describer.chat(s, user.uid, text, Date.now());
      else if (s.settings.kind === "drawer" && s.phase === "draw_guess") result = drawer.guess(s, user.uid, text, Date.now());
      else s.chat.push({ id: (s.chat.at(-1)?.id ?? 0) + 1, at: Date.now(), playerId: user.uid, text, kind: "chat" });
      break;
    }
    case "describe_choose":
      describer.choose(s, user.uid, a.index, Date.now());
      break;
    case "describe_skip":
      if (describer.skipItem(s, user.uid)) await feedDescriber(live);
      break;
    case "draw_choose":
      drawer.choose(s, user.uid, a.index);
      break;
    case "draw_submit": {
      const id = await saveDrawingPng(s, user.uid, a.png);
      drawer.submit(s, user.uid, id, Date.now());
      break;
    }
    case "draw_vote":
      drawer.vote(s, user.uid, a.drawingId, a.kind);
      break;
    case "alias_propose":
      result = { ok: proposeAlias(s, user.uid, a.text) };
      break;
    case "alias_vote": {
      const v = voteAlias(s, user.uid, a.yes);
      const q = v && s.questions.find((x) => x.id === v.questionId);
      if (v && q?.entity) {
        // the name becomes a permanent alias
        await getRepo().addAlias(q.entity.kind, q.entity.id, v.text);
        invalidateLibrary();
      }
      break;
    }
  }
  await advance(live, Date.now());
  publish(s.code);
  return result;
}

async function saveDrawingPng(s: RoomState, uid: string, dataUrl: string): Promise<string> {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { MEDIA_DIR } = await import("./env");
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new Error("bad png");
  const buf = Buffer.from(m[1], "base64");
  if (buf.length > 3_000_000) throw new Error("too big");
  const id = randomBytes(10).toString("hex");
  const rel = join("drawings", `${id}.png`);
  mkdirSync(join(MEDIA_DIR, "drawings"), { recursive: true });
  writeFileSync(join(MEDIA_DIR, rel), buf);
  const item = drawer.itemOf(s, uid);
  await getRepo().saveDrawing({ id, roomCode: s.tag ?? s.code, userId: uid, workId: item?.workId ?? "", subject: item?.display.title ?? "", png: rel, votesBest: 0, votesFunny: 0, at: Date.now() });
  return id;
}

export function systemNote(code: string, text: string) {
  const live = getLive(code);
  if (live) {
    systemMsg(live.state, text);
    publish(live.state.code);
  }
}
