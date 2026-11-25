import type { RoomState } from "./room";
import { systemMsg } from "./room";
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
}

const CHOOSE_SEC = 15;
const REVEAL_SEC = 7;

function st(s: RoomState): DescriberState {
  return s.party as DescriberState;
}

export function describerId(s: RoomState): string | undefined {
  const d = st(s);
  if (!d) return undefined;
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
  s.party = { order, turn: 0, totalTurns: Math.max(1, s.settings.count) * order.length, offered: [], requested: false, skipsLeft: 1, guessed: {}, penalty: 0 } satisfies DescriberState;
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
  setPhase(s, "describe_turn", now, s.settings.describe.turnSec);
  const p = s.players.find((x) => x.id === uid);
  systemMsg(s, `${p?.name} يوصف الحين`, now);
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
  const pts = Math.round(scoreAnswer({ correct: true, elapsedMs: now - s.phaseStartedAt, timeLimitMs: s.phaseEndsAt - s.phaseStartedAt, tier: d.item.tier, method: "text" }) * factor);
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
  if (s.phase === "describe_turn" && now >= s.phaseEndsAt) {
    const descr = describerId(s)!;
    const scored: ScoredRow[] = [];
    let helper = 0;
    for (const [pid, g] of Object.entries(d.guessed)) {
      const p = s.players.find((x) => x.id === pid);
      if (p) p.score += g.points;
      helper += helperPoints(g.points);
      scored.push(row(d.item!, pid, g.points, g.factor === 1, "guesser"));
    }
    const dp = s.players.find((x) => x.id === descr);
    const describerPts = helper - d.penalty;
    if (dp) dp.score += describerPts;
    scored.push(row(d.item!, descr, describerPts, Object.keys(d.guessed).length > 0, "describer"));
    s.phase = "describe_reveal";
    s.phaseStartedAt = now;
    s.phaseEndsAt = now + REVEAL_SEC * 1000;
    return { changed: true, scored };
  }
  if (s.phase === "describe_reveal" && now >= s.phaseEndsAt) {
    d.turn++;
    d.item = undefined;
    d.offered = [];
    d.requested = false;
    d.skipsLeft = 1;
    d.guessed = {};
    if (d.turn >= d.totalTurns) {
      s.phase = "finished";
      s.phaseStartedAt = now;
      s.phaseEndsAt = Number.POSITIVE_INFINITY;
      return { changed: true, finished: true };
    }
    s.phase = "describe_choose";
    s.phaseStartedAt = now;
    s.phaseEndsAt = now + CHOOSE_SEC * 1000;
    return { changed: true, needItems: (d.requested = true) };
  }
  return {};
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
      mine && d.item && s.phase === "describe_turn"
        ? { title: d.item.display.title, titleAr: d.item.display.titleAr, sub: d.item.display.sub, image: priv(d.item.image), forbidden: [...new Set(d.item.forbidden)].slice(0, 30) }
        : undefined,
    reveal: s.phase === "describe_reveal" && d.item ? { ...d.item.display, image: image(d.item.image) } : undefined,
    guessed: Object.fromEntries(Object.entries(d.guessed).map(([k, v]) => [k, v.factor])),
    penalty: d.penalty,
    via: s.settings.describe.via,
  };
}
