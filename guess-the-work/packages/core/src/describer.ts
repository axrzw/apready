import type { RoomState } from "./room";
import { systemMsg, reachEnd } from "./room";
import { findNames, matchAnswer, redactNames } from "./match";
import { scoreAnswer, helperPoints } from "./scoring";
import { pickPartyItems, type PartyItem, type PickOptions } from "./party";
import type { LibraryIndex } from "./library";
import type { AnswerRecord } from "./records";

export type ScoredRow = AnswerRecord;

export interface DescriberState {
  order: string[];
  turn: number;
  totalTurns: number;
  offered: PartyItem[];
  item?: PartyItem;
  requested: boolean;
  skipsLeft: number;
  guessed: Record<string, { points: number; at: number; factor: number }>;
  penalty: number;
  /** "اشرح بالكاميرا": how this turn is explained (camera, or talking like the describer) */
  turnMode?: "camera" | "talk";
  /** setup time left when the explainer opened the "no camera" confirm (for "back") */
  setupLeft?: number;
  /** "talk" style: reported forbidden words, approved by the host */
  reports?: { id: number; by: string; at: number; status: "open" | "approved" | "rejected" }[];
  /** whose turn it is (pinned, so somebody leaving does not hand the turn to another player) */
  current?: string;
}

const CONFIRM_SEC = 10;
const isCamera = (s: RoomState) => s.settings.kind === "camera";

const CHOOSE_SEC = 15;
const REVEAL_SEC = 7;

function st(s: RoomState): DescriberState {
  return s.party as DescriberState;
}

export function describerId(s: RoomState): string | undefined {
  const d = st(s);
  if (!d) return undefined;
  if (d.current && s.players.some((p) => p.id === d.current)) return d.current;
  const alive = d.order.filter((id) => s.players.some((p) => p.id === id));
  return alive[d.turn % Math.max(1, alive.length)];
}

function setPhase(s: RoomState, phase: RoomState["phase"], now: number, sec: number) {
  s.phase = phase;
  s.phaseStartedAt = now;
  s.phaseEndsAt = now + sec * 1000;
}

export function startDescriber(s: RoomState, by: string, now: number) {
  if (by !== s.hostId) throw new Error("only the host");
  if (s.players.length < 2) throw new Error("يبي لاعبين على الأقل");
  for (const p of s.players) (p.score = 0), (p.streak = 0);
  const order = s.players.map((p) => p.id);
  s.party = { order, turn: 0, totalTurns: Math.max(1, s.settings.count) * order.length, offered: [], requested: false, skipsLeft: 1, guessed: {}, penalty: 0, current: order[0] } satisfies DescriberState;
  s.stopping = false;
  s.ending = undefined;
  s.questions = [];
  setPhase(s, "describe_choose", now, CHOOSE_SEC);
}

export function pickItems(lib: LibraryIndex, n: number, o: PickOptions): PartyItem[] {
  return pickPartyItems(lib, n, o, "describer");
}

export function giveItems(s: RoomState, items: PartyItem[], now: number) {
  const d = st(s);
  d.offered = items;
  d.requested = false;
  if (!items.length) return;
  if (items.length === 1 || !s.settings.describe.choose) choose(s, describerId(s)!, 0, now);
  else setPhase(s, "describe_choose", now, CHOOSE_SEC);
}

export function choose(s: RoomState, uid: string, index: number, now: number) {
  const d = st(s);
  if (uid !== describerId(s) || s.phase !== "describe_choose" || !d.offered[index]) return;
  d.item = d.offered[index];
  d.guessed = {};
  d.penalty = 0;
  d.reports = [];
  if (isCamera(s)) {
    // time to switch the camera on in Discord
    d.turnMode = undefined;
    setPhase(s, "camera_setup", now, s.settings.camera.setupSec);
    return;
  }
  d.turnMode = "talk";
  startTurn(s, uid, now);
}

function startTurn(s: RoomState, uid: string, now: number) {
  setPhase(s, "describe_turn", now, s.settings.describe.turnSec);
  const p = s.players.find((x) => x.id === uid);
  const d = st(s);
  systemMsg(s, d.turnMode === "camera" ? `شغّلوا بث ${p?.name} في الديسكورد` : `${p?.name} يوصف الحين`, now);
}

/** «الكاميرا جاهزة»: the turn starts at once. */
export function cameraReady(s: RoomState, uid: string, now: number) {
  if (uid !== describerId(s) || (s.phase !== "camera_setup" && s.phase !== "camera_confirm")) return;
  st(s).turnMode = "camera";
  startTurn(s, uid, now);
}

/** «ما عندي كاميرا»: shows the confirm (talk / skip my turn / back). */
export function noCamera(s: RoomState, uid: string, now: number) {
  if (uid !== describerId(s) || s.phase !== "camera_setup") return;
  st(s).setupLeft = Math.max(0, s.phaseEndsAt - now);
  setPhase(s, "camera_confirm", now, Math.max(CONFIRM_SEC, Math.ceil(st(s).setupLeft! / 1000)));
}

export function cameraChoice(s: RoomState, uid: string, choice: "talk" | "skip" | "back", now: number) {
  if (uid !== describerId(s) || s.phase !== "camera_confirm") return;
  const d = st(s);
  if (choice === "back") {
    setPhase(s, "camera_setup", now, Math.max(5, Math.ceil((d.setupLeft ?? CONFIRM_SEC * 1000) / 1000)));
    return;
  }
  if (choice === "talk") {
    d.turnMode = "talk";
    startTurn(s, uid, now);
    return;
  }
  skipTurn(s, now);
}

/** The describer left mid-turn: nobody scores, the next player goes. */
export function abortTurn(s: RoomState, now: number) {
  const d = st(s);
  d.guessed = {};
  d.penalty = 0;
  nextTurn(s, now);
}

/** The turn passes to the next player: no points, no penalty. */
function skipTurn(s: RoomState, now: number) {
  const d = st(s);
  const p = s.players.find((x) => x.id === describerId(s));
  systemMsg(s, `${p?.name ?? ""} تخطى دوره`, now);
  nextTurn(s, now);
  d.requested = false;
}

/** «مخالفة»: a guesser reports a forbidden word (camera, talking style). The host approves it. */
export function reportViolation(s: RoomState, uid: string, now: number): number | null {
  const d = st(s);
  if (!isCamera(s) || s.settings.camera.style !== "talk" || d.turnMode !== "camera" || s.phase !== "describe_turn" || uid === describerId(s)) return null;
  const id = (d.reports?.at(-1)?.id ?? 0) + 1;
  d.reports = [...(d.reports ?? []), { id, by: uid, at: now, status: "open" }];
  systemMsg(s, `${s.players.find((p) => p.id === uid)?.name ?? ""} بلّغ عن كلمة ممنوعة`, now);
  return id;
}

export function approveReport(s: RoomState, by: string, id: number, approve = true) {
  if (by !== s.hostId) throw new Error("only the host");
  const d = st(s);
  const r = d.reports?.find((x) => x.id === id);
  if (!r || r.status !== "open") return;
  r.status = approve ? "approved" : "rejected";
  if (approve) d.penalty += s.settings.describe.penalty;
}

export function skipItem(s: RoomState, uid: string): boolean {
  const d = st(s);
  if (uid !== describerId(s) || d.skipsLeft <= 0 || !["describe_turn", "describe_choose"].includes(s.phase)) return false;
  d.skipsLeft--;
  d.item = undefined;
  d.offered = [];
  d.requested = true;
  s.phase = "describe_choose";
  return true;
}

export interface GuessResult {
  correct: boolean;
  points: number;
  factor?: number;
}

export function guess(s: RoomState, uid: string, text: string, now: number): GuessResult {
  const d = st(s);
  if (s.phase !== "describe_turn" || !d.item || uid === describerId(s)) return { correct: false, points: 0 };
  if (d.guessed[uid]?.factor === 1) return { correct: true, points: d.guessed[uid].points };
  const full = matchAnswer(text, d.item.names).ok;
  const part = !full && d.item.kind === "character" && matchAnswer(text, d.item.workNames).ok;
  if (!full && !part) {
    s.chat.push({ id: (s.chat.at(-1)?.id ?? 0) + 1, at: now, playerId: uid, text, kind: "guess" });
    return { correct: false, points: 0 };
  }
  const factor = full ? 1 : 0.4;
  const rank = Object.values(d.guessed).filter((g) => g.factor === 1).length + 1;
  const pts = scoreAnswer({ correct: full, factor, elapsedMs: now - s.phaseStartedAt, timeLimitMs: s.phaseEndsAt - s.phaseStartedAt, tier: d.item.tier, method: "text", hintsUsed: 0, streak: 0, rank: full ? rank : 99 }, s.settings.scoring).total;
  const prev = d.guessed[uid];
  if (!prev || prev.points < pts) d.guessed[uid] = { points: pts, at: now, factor };
  const name = s.players.find((p) => p.id === uid)?.name;
  systemMsg(s, full ? `${name} عرفها` : `${name} عرف العمل (جزء من النقاط)`, now);
  const guessers = s.players.filter((p) => p.id !== describerId(s));
  if (guessers.every((p) => d.guessed[p.id]?.factor === 1)) s.phaseEndsAt = Math.min(s.phaseEndsAt, now + 1500);
  return { correct: full, points: pts, factor };
}

/** Chat: the describer's forbidden words are hidden and cost points; others' messages count as guesses. */
export function chat(s: RoomState, uid: string, text: string, now: number): { masked?: boolean; penalty?: number } | GuessResult {
  const d = st(s);
  if (s.phase === "describe_turn" && d?.item && uid === describerId(s)) {
    const hits = findNames(text, d.item.forbidden);
    const out = hits.length ? redactNames(text, d.item.forbidden, "▇▇") : text;
    s.chat.push({ id: (s.chat.at(-1)?.id ?? 0) + 1, at: now, playerId: uid, text: out, kind: "describer", masked: hits.length > 0 });
    if (hits.length) {
      const pen = s.settings.describe.penalty * hits.length;
      d.penalty += pen;
      systemMsg(s, `كلمة ممنوعة: خصم ${pen}`, now);
      return { masked: true, penalty: pen };
    }
    return { masked: false };
  }
  if (s.phase === "describe_turn") return guess(s, uid, text, now);
  s.chat.push({ id: (s.chat.at(-1)?.id ?? 0) + 1, at: now, playerId: uid, text, kind: "chat" });
  return { masked: false };
}

export interface TickResult {
  changed?: boolean;
  needItems?: boolean;
  scored?: ScoredRow[];
  finished?: boolean;
}

export function tickDescriber(s: RoomState, now: number): TickResult {
  const d = st(s);
  if (!d || s.phase === "finished" || s.phase === "lobby") return {};
  if (s.phase === "describe_choose") {
    if (!d.offered.length) {
      // ask for items; ask again if they never came (the clock ran out)
      if (!d.requested || now >= s.phaseEndsAt) {
        d.requested = true;
        s.phaseEndsAt = now + CHOOSE_SEC * 1000;
        return { needItems: true, changed: true };
      }
      return {};
    }
    if (now >= s.phaseEndsAt) {
      choose(s, describerId(s)!, 0, now);
      return { changed: true };
    }
    return {};
  }
  if (s.phase === "camera_setup" && now >= s.phaseEndsAt) {
    // nobody pressed anything: ask "no camera?"; no answer in 10 s skips the turn
    st(s).setupLeft = 0;
    setPhase(s, "camera_confirm", now, CONFIRM_SEC);
    return { changed: true };
  }
  if (s.phase === "camera_confirm" && now >= s.phaseEndsAt) {
    skipTurn(s, now);
    return { changed: true, needItems: true };
  }
  if (s.phase === "describe_turn" && now >= s.phaseEndsAt) {
    const descr = describerId(s)!;
    const scored: ScoredRow[] = [];
    let helper = 0;
    for (const [pid, g] of Object.entries(d.guessed)) {
      const p = s.players.find((x) => x.id === pid);
      if (p) p.score += g.points;
      helper += helperPoints(g.points, s.settings.scoring);
      scored.push(row(d.item!, pid, g.points, g.factor === 1, "guesser"));
    }
    const dp = s.players.find((x) => x.id === descr);
    const describerPts = helper - d.penalty;
    if (dp) dp.score += describerPts;
    scored.push(row(d.item!, descr, describerPts, Object.keys(d.guessed).length > 0, "describer"));
    s.phase = "describe_reveal";
    s.phaseStartedAt = now;
    s.phaseEndsAt = now + (s.stopping ? 0 : REVEAL_SEC * 1000);
    return { changed: true, scored };
  }
  if (s.phase === "describe_reveal" && now >= s.phaseEndsAt) return nextTurn(s, now);
  return {};
}

/** Next player's turn (or the end). Items are asked for on the next tick. */
function nextTurn(s: RoomState, now: number): TickResult {
  const d = st(s);
  d.turn++;
  d.item = undefined;
  d.offered = [];
  d.requested = false;
  d.skipsLeft = 1;
  d.guessed = {};
  d.turnMode = undefined;
  d.reports = [];
  d.current = nextAlive(s, d.order, d.current);
  if (d.turn >= d.totalTurns || s.stopping) {
    if (reachEnd(s, now) === "end") return { changed: true, finished: s.phase === "finished" };
    d.totalTurns += s.players.filter((p) => d.order.includes(p.id)).length; // «مفتوح»: another round
  }
  resumeTurns(s, now);
  return { changed: true, needItems: (d.requested = true) };
}

/** The next player in the turn order who is still in the room. */
function nextAlive(s: RoomState, order: string[], from?: string): string | undefined {
  const i = from ? order.indexOf(from) : -1;
  for (let k = 1; k <= order.length; k++) {
    const id = order[(i + k + order.length) % order.length];
    if (s.players.some((p) => p.id === id && !p.spectator)) return id;
  }
  return undefined;
}

/** Turns go on (after the next turn, or «زد» on the ending screen). Items are asked for on the next tick. */
export function resumeTurns(s: RoomState, now: number): TickResult {
  const d = st(s);
  s.ending = undefined;
  s.phase = "describe_choose";
  s.phaseStartedAt = now;
  s.phaseEndsAt = now + CHOOSE_SEC * 1000;
  d.offered = [];
  d.requested = false; // the next tick asks for items
  return { changed: true };
}

function row(item: PartyItem, userId: string, points: number, correct: boolean, role: "describer" | "guesser"): ScoredRow {
  return { userId, questionKey: item.key, mode: "describer", workId: item.workId, category: item.category, tier: item.tier, correct, points, method: "text", hintsUsed: 0, role };
}

export interface TokenReq {
  asset: { type: "plain"; src: string };
  users?: string[];
}

export function describerView(s: RoomState, uid: string, token: (r: TokenReq) => string, image: (src: string) => string) {
  const d = st(s);
  if (!d) return undefined;
  const descr = describerId(s);
  const mine = uid === descr;
  const priv = (src: string) => token({ asset: { type: "plain", src }, users: [descr!] });
  return {
    describerId: descr,
    turn: d.turn,
    totalTurns: d.totalTurns,
    skipsLeft: mine ? d.skipsLeft : undefined,
    offered: mine && s.phase === "describe_choose" ? d.offered.map((it) => ({ title: it.display.title, titleAr: it.display.titleAr, sub: it.display.sub, image: priv(it.image) })) : undefined,
    item:
      mine && d.item && ["describe_turn", "camera_setup", "camera_confirm"].includes(s.phase)
        ? { title: d.item.display.title, titleAr: d.item.display.titleAr, sub: d.item.display.sub, image: priv(d.item.image), forbidden: [...new Set(d.item.forbidden)].slice(0, 30) }
        : undefined,
    reveal: s.phase === "describe_reveal" && d.item ? { ...d.item.display, image: image(d.item.image) } : undefined,
    guessed: Object.fromEntries(Object.entries(d.guessed).map(([k, v]) => [k, v.factor])),
    penalty: d.penalty,
    via: s.settings.describe.via,
    camera: s.settings.kind === "camera",
    cameraStyle: s.settings.camera.style,
    cameraOn: d.turnMode === "camera",
    turnMode: d.turnMode,
    reports: (d.reports ?? []).map((r) => ({ id: r.id, by: r.by, status: r.status })),
  };
}
