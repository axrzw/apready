import type { Category, ModeId, TierMix } from "./types";
import { DEFAULT_TIER_MIX } from "./types";
import type { ImageEffectId } from "./effects";
import { POSTER_EFFECTS } from "./effects";
import { checkAnswer, type Question } from "./questions";
import { DEFAULT_SCORING, scoreAnswer, type ScoreBreakdown, type ScoreMethod, type ScoringConfig } from "./scoring";

export type RoomKind = "guess" | "describer" | "drawer";

export interface RoomSettings {
  kind: RoomKind;
  modes: ModeId[]; // one mode or several (Mix)
  count: number; // questions (guess) or rounds (party)
  categories: Category[];
  mix: TierMix;
  timeLimitSec: number;
  /** how players answer: typing (ar/en), 4 choices (fewer points) or both */
  method: "text" | "choice" | "both";
  hints: { enabled: boolean; max: number; reveal: "request" | "auto" };
  effects: ImageEffectId[];
  sceneLevel: 1 | 2 | 3;
  revealSec: number;
  repeatAfterDays: number;
  adaptive: boolean;
  describe: { via: "voice" | "chat"; choose: boolean; turnSec: number; penalty: number };
  /** only the first correct answer scores */
  firstOnly: boolean;
  /** suggestions while typing: on, off (challenge), or on with fewer points */
  autocomplete: "on" | "off" | "reduced";
  scoring: ScoringConfig;
  draw: { drawSec: number; guessSec: number; voteSec: number; choose: boolean };
}

export const DEFAULT_SETTINGS: RoomSettings = {
  kind: "guess",
  modes: ["poster"],
  count: 10,
  categories: [],
  mix: DEFAULT_TIER_MIX,
  timeLimitSec: 30,
  method: "both",
  hints: { enabled: true, max: 4, reveal: "request" },
  effects: POSTER_EFFECTS,
  sceneLevel: 1,
  revealSec: 6,
  repeatAfterDays: 60,
  adaptive: true,
  describe: { via: "voice", choose: true, turnSec: 75, penalty: 150 },
  draw: { drawSec: 90, guessSec: 30, voteSec: 40, choose: true },
  firstOnly: false,
  autocomplete: "on",
  scoring: DEFAULT_SCORING,
};

export interface Player {
  id: string;
  name: string;
  avatar?: string;
  color?: string;
  score: number;
  streak: number;
  lastSeen: number;
  /** joined while a game was running: watches until they ask to play */
  spectator?: boolean;
}

export interface AnswerState {
  correct: boolean;
  factor: number;
  points: number;
  at: number;
  method: "text" | "choice";
  /** how the points were made (shown on the reveal) */
  breakdown?: ScoreBreakdown;
  hints?: number;
  /** wrong attempts typed (shown to the player only) */
  tries: number;
}

export interface ChatMessage {
  id: number;
  at: number;
  playerId: string;
  text: string;
  /** "guess" messages are hidden when they are right; "system" are from the game */
  kind: "chat" | "guess" | "system" | "describer";
  masked?: boolean;
}

export type Phase =
  | "lobby"
  | "question"
  | "reveal"
  | "finished"
  | "describe_choose"
  | "describe_turn"
  | "describe_reveal"
  | "draw"
  | "draw_guess"
  | "draw_vote";

export interface RoomState {
  code: string;
  hostId: string;
  settings: RoomSettings;
  players: Player[];
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number;
  questions: Question[];
  index: number;
  answers: Record<string, AnswerState>;
  hintsUsed: Record<string, number>;
  chat: ChatMessage[];
  /** party mode state (describer / drawer) */
  party?: unknown;
  createdAt: number;
  /** set when the room is the daily challenge or a solo game */
  tag?: string;
  /** "اعتمد جوابي": a player asks the others to accept what they typed */
  aliasVote?: AliasVote;
  /** players who loaded the current question's media */
  loaded?: string[];
  kicked?: string[];
  paused?: boolean;
  pausedAt?: number;
  pausedLeft?: number;
}

/** A question waits for everyone's media at most this long. */
export const PRELOAD_MAX_MS = 6000;
/** Countdown after everybody loaded. */
export const START_DELAY_MS = 1000;

export interface AliasVote {
  by: string;
  text: string;
  questionId: string;
  yes: string[];
  no: string[];
  status: "open" | "accepted" | "rejected";
}

export interface AnswerResult {
  correct: boolean;
  factor: number;
  points: number;
  already?: boolean;
  closed?: boolean;
}

export function createRoom(code: string, host: { id: string; name: string; avatar?: string; color?: string }, settings: Partial<RoomSettings> = {}, now = Date.now()): RoomState {
  return {
    code,
    hostId: host.id,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    players: [{ ...host, score: 0, streak: 0, lastSeen: now }],
    phase: "lobby",
    phaseStartedAt: now,
    phaseEndsAt: Number.POSITIVE_INFINITY,
    questions: [],
    index: 0,
    answers: {},
    hintsUsed: {},
    chat: [],
    createdAt: now,
  };
}

export function join(s: RoomState, p: { id: string; name: string; avatar?: string; color?: string }, now = Date.now()): RoomState {
  if (s.kicked?.includes(p.id)) return s;
  const found = s.players.find((x) => x.id === p.id);
  if (found) {
    found.lastSeen = now;
    found.name = p.name;
    found.avatar = p.avatar;
    found.color = p.color;
    return s;
  }
  const running = s.phase !== "lobby" && s.phase !== "finished";
  s.players.push({ ...p, score: 0, streak: 0, lastSeen: now, spectator: running || undefined });
  systemMsg(s, running ? `${p.name} يتفرج` : `${p.name} دخل الغرفة`, now);
  return s;
}

export function leave(s: RoomState, playerId: string, now = Date.now()): RoomState {
  const p = s.players.find((x) => x.id === playerId);
  if (!p) return s;
  s.players = s.players.filter((x) => x.id !== playerId);
  systemMsg(s, `${p.name} طلع`, now);
  if (s.hostId === playerId && s.players.length) s.hostId = s.players[0].id;
  return s;
}

export function updateSettings(s: RoomState, by: string, patch: Partial<RoomSettings>): RoomState {
  if (by !== s.hostId || s.phase !== "lobby") throw new Error("only the host, in the lobby");
  s.settings = { ...s.settings, ...patch, hints: { ...s.settings.hints, ...patch.hints }, describe: { ...s.settings.describe, ...patch.describe }, draw: { ...s.settings.draw, ...patch.draw } };
  return s;
}

export function systemMsg(s: RoomState, text: string, now = Date.now()) {
  s.chat.push({ id: (s.chat.at(-1)?.id ?? 0) + 1, at: now, playerId: "system", text, kind: "system" });
  if (s.chat.length > 300) s.chat.splice(0, s.chat.length - 300);
}

function setPhase(s: RoomState, phase: Phase, now: number, seconds: number) {
  s.phase = phase;
  s.phaseStartedAt = now;
  s.phaseEndsAt = seconds === Number.POSITIVE_INFINITY ? seconds : now + seconds * 1000;
}

/** Start a guessing game with already generated questions. */
export function startGuess(s: RoomState, by: string, questions: Question[], now = Date.now()): RoomState {
  if (by !== s.hostId) throw new Error("only the host");
  if (!questions.length) throw new Error("no questions");
  s.questions = questions;
  s.index = 0;
  for (const p of s.players) {
    p.score = 0;
    p.streak = 0;
  }
  openQuestion(s, now);
  return s;
}

function openQuestion(s: RoomState, now: number) {
  s.answers = {};
  s.aliasVote = undefined;
  s.hintsUsed = {};
  s.loaded = [];
  const q = s.questions[s.index];
  // the clock starts when everyone has the media (or after PRELOAD_MAX_MS)
  const limit = q.timeLimitMs || s.settings.timeLimitSec * 1000;
  s.phase = "question";
  s.phaseStartedAt = now + PRELOAD_MAX_MS;
  s.phaseEndsAt = s.phaseStartedAt + limit;
}

function activePlayers(s: RoomState, now: number) {
  return s.players.filter((p) => !p.spectator && now - p.lastSeen < 30_000);
}

/** A client says it has the question's media. When all active players have it, a short countdown starts. */
export function markLoaded(s: RoomState, playerId: string, questionId: string, now = Date.now()) {
  const q = s.questions[s.index];
  if (s.phase !== "question" || q?.id !== questionId || now >= s.phaseStartedAt) return;
  s.loaded = [...new Set([...(s.loaded ?? []), playerId])];
  if (activePlayers(s, now).every((p) => s.loaded!.includes(p.id))) {
    const limit = s.phaseEndsAt - s.phaseStartedAt;
    s.phaseStartedAt = Math.min(s.phaseStartedAt, now + START_DELAY_MS);
    s.phaseEndsAt = s.phaseStartedAt + limit;
  }
}

function hostOnly(s: RoomState, by: string) {
  if (by !== s.hostId) throw new Error("only the host");
}

export function kick(s: RoomState, by: string, target: string, now = Date.now()) {
  hostOnly(s, by);
  if (target === by) throw new Error("not yourself");
  const p = s.players.find((x) => x.id === target);
  s.players = s.players.filter((x) => x.id !== target);
  s.kicked = [...new Set([...(s.kicked ?? []), target])];
  if (p) systemMsg(s, `${p.name} انطرد`, now);
}

export function transferHost(s: RoomState, by: string, to: string, now = Date.now()) {
  hostOnly(s, by);
  const p = s.players.find((x) => x.id === to);
  if (!p) throw new Error("no such player");
  s.hostId = to;
  systemMsg(s, `${p.name} صار المضيف`, now);
}

/** Freezes the clock (answers wait). */
export function pause(s: RoomState, by: string, now = Date.now()) {
  hostOnly(s, by);
  if (s.paused || !Number.isFinite(s.phaseEndsAt)) return;
  s.paused = true;
  s.pausedAt = now;
  s.pausedLeft = Math.max(0, s.phaseEndsAt - now);
  s.phaseEndsAt = Number.POSITIVE_INFINITY;
}

export function resume(s: RoomState, by: string, now = Date.now()) {
  hostOnly(s, by);
  if (!s.paused) return;
  const shift = now - (s.pausedAt ?? now);
  s.phaseStartedAt += shift;
  s.phaseEndsAt = now + (s.pausedLeft ?? 0);
  s.paused = false;
  s.pausedAt = s.pausedLeft = undefined;
}

export function becomePlayer(s: RoomState, uid: string) {
  const p = s.players.find((x) => x.id === uid);
  if (p) p.spectator = false;
}

export function currentQuestion(s: RoomState): Question | undefined {
  return s.phase === "question" || s.phase === "reveal" ? s.questions[s.index] : undefined;
}

/** Hints the player has open now (requested, or released over time in "auto" mode). */
export function hintsOpen(s: RoomState, playerId: string, now = Date.now()): number {
  const q = currentQuestion(s);
  if (!q || !s.settings.hints.enabled) return 0;
  const max = Math.min(s.settings.hints.max, q.hints.length);
  if (s.settings.hints.reveal === "auto") {
    const frac = (now - s.phaseStartedAt) / (s.phaseEndsAt - s.phaseStartedAt);
    return Math.min(max, Math.floor(frac * (max + 1)));
  }
  return Math.min(max, s.hintsUsed[playerId] ?? 0);
}

export function requestHint(s: RoomState, playerId: string, now = Date.now()): number {
  if (s.phase !== "question" || !s.settings.hints.enabled || s.settings.hints.reveal !== "request") return hintsOpen(s, playerId, now);
  if (s.answers[playerId]?.correct) return hintsOpen(s, playerId, now);
  const q = currentQuestion(s)!;
  s.hintsUsed[playerId] = Math.min(Math.min(s.settings.hints.max, q.hints.length), (s.hintsUsed[playerId] ?? 0) + 1);
  return s.hintsUsed[playerId];
}

export interface Submission {
  text?: string;
  choice?: string;
  order?: string[];
  /** picked from the autocomplete list: the id of a work / character / song */
  entityId?: string;
}

export function submitAnswer(s: RoomState, playerId: string, sub: Submission, now = Date.now()): AnswerResult {
  const q = currentQuestion(s);
  if (!q || s.phase !== "question" || s.paused || now > s.phaseEndsAt || now < s.phaseStartedAt) return { correct: false, factor: 0, points: 0, closed: true };
  const player = s.players.find((p) => p.id === playerId);
  if (!player || player.spectator) return { correct: false, factor: 0, points: 0, closed: true };
  const prev = s.answers[playerId];
  if (prev?.correct) return { ...prev, already: true };
  const usingChoice = sub.choice !== undefined && q.answerType === "text";
  if (usingChoice && s.settings.method === "text") return { correct: false, factor: 0, points: 0, closed: true };
  if (!usingChoice && q.answerType === "text" && s.settings.method === "choice") return { correct: false, factor: 0, points: 0, closed: true };
  // one shot for choices / order; typed answers can be retried until right
  if (prev && (prev.method === "choice" || q.answerType !== "text")) return { ...prev, already: true };
  if (sub.entityId !== undefined && s.settings.autocomplete === "off") return { correct: false, factor: 0, points: 0, closed: true };
  const check = checkAnswer(q, sub);
  const method: "text" | "choice" = usingChoice || q.answerType !== "text" ? "choice" : "text";
  const scoreMethod: ScoreMethod =
    q.answerType !== "text" ? "text" : usingChoice ? "choice" : sub.entityId !== undefined ? (s.settings.autocomplete === "reduced" ? "autocomplete_reduced" : "autocomplete") : "text";
  const opened = s.settings.hints.reveal === "request" ? hintsOpen(s, playerId, now) : 0;
  const rank = check.correct ? Object.values(s.answers).filter((a) => a.correct).length + 1 : 99;
  const breakdown = scoreAnswer(
    {
      correct: check.correct,
      factor: check.factor,
      elapsedMs: now - s.phaseStartedAt,
      timeLimitMs: s.phaseEndsAt - s.phaseStartedAt,
      tier: q.tier,
      method: scoreMethod,
      hintsUsed: opened,
      hintTotal: q.hints.length,
      streak: check.correct ? player.streak : 0,
      rank,
      firstOnly: s.settings.firstOnly,
    },
    s.settings.scoring ?? DEFAULT_SCORING,
  );
  const pts = breakdown.total;
  const tries = (prev?.tries ?? 0) + (check.correct ? 0 : 1);
  // a partial answer (the work instead of the character) is kept, but the player may still try for full points
  const better = !prev || pts > prev.points || (check.correct && !prev.correct);
  s.answers[playerId] = better ? { correct: check.correct, factor: check.factor, points: pts, at: now, method, tries, breakdown, hints: opened } : { ...prev, tries };
  if (check.correct) player.streak++;
  if (allDone(s)) s.phaseEndsAt = Math.min(s.phaseEndsAt, now + 800);
  return { correct: check.correct, factor: check.factor, points: better ? pts : prev!.points };
}

function allDone(s: RoomState) {
  const q = currentQuestion(s);
  if (!q) return false;
  return s.players.filter((p) => !p.spectator).every((p) => {
    const a = s.answers[p.id];
    return a && (a.correct || a.method === "choice" || q.answerType !== "text");
  });
}

/** Host skips the current question. */
export function skip(s: RoomState, by: string, now = Date.now()) {
  if (by !== s.hostId) throw new Error("only the host");
  if (s.phase === "question") s.phaseEndsAt = now;
  else if (s.phase === "reveal") s.phaseEndsAt = now;
  return tick(s, now);
}

export interface TickEvents {
  /** answers to store (question closed) */
  closed?: { question: Question; answers: Record<string, AnswerState> };
  finished?: boolean;
}

/** Moves the game on by the clock. Call it on every request / every second: no player can freeze the room. */
export function tick(s: RoomState, now = Date.now()): TickEvents {
  const ev: TickEvents = {};
  if (s.settings.kind !== "guess" || now < s.phaseEndsAt) return ev;
  if (s.phase === "question") {
    const q = s.questions[s.index];
    for (const p of s.players) {
      const a = s.answers[p.id];
      if (a?.points) p.score += a.points;
      if (!a?.correct) p.streak = 0;
    }
    ev.closed = { question: q, answers: { ...s.answers } };
    setPhase(s, "reveal", now, s.settings.revealSec);
    return ev;
  }
  if (s.phase === "reveal") {
    if (s.index + 1 < s.questions.length) {
      s.index++;
      openQuestion(s, now);
    } else {
      setPhase(s, "finished", now, Number.POSITIVE_INFINITY);
      ev.finished = true;
    }
  }
  return ev;
}

/** A player who was marked wrong asks the others to accept their answer (during the reveal). */
export function proposeAlias(s: RoomState, uid: string, text: string, now = Date.now()): boolean {
  const q = currentQuestion(s);
  if (s.phase !== "reveal" || !q?.entity || s.aliasVote?.status === "open" || s.players.length < 2) return false;
  if (s.answers[uid]?.correct) return false;
  s.aliasVote = { by: uid, text: text.trim().slice(0, 80), questionId: q.id, yes: [], no: [], status: "open" };
  s.phaseEndsAt = Math.max(s.phaseEndsAt, now + 12_000);
  return true;
}

/** Returns the accepted vote once more than half of the other players said yes. */
export function voteAlias(s: RoomState, uid: string, yes: boolean, now = Date.now()): AliasVote | null {
  const v = s.aliasVote;
  if (!v || v.status !== "open" || uid === v.by || v.yes.includes(uid) || v.no.includes(uid)) return null;
  (yes ? v.yes : v.no).push(uid);
  const others = s.players.length - 1;
  if (v.yes.length > others / 2) {
    v.status = "accepted";
    const q = s.questions.find((x) => x.id === v.questionId);
    const p = s.players.find((x) => x.id === v.by);
    if (q && p) {
      const pts = scoreAnswer({ correct: true, elapsedMs: 0, timeLimitMs: 1, tier: q.tier, method: "text", hintsUsed: 0, streak: 0, rank: 99 }, s.settings.scoring ?? DEFAULT_SCORING).total;
      p.score += pts;
      q.names.push(v.text);
    }
    s.phaseEndsAt = Math.min(s.phaseEndsAt, now + 3000);
    return v;
  }
  if (v.no.length >= others / 2) {
    v.status = "rejected";
    s.phaseEndsAt = Math.min(s.phaseEndsAt, now + 3000);
  }
  return null;
}

export function backToLobby(s: RoomState, by: string, now = Date.now()) {
  if (by !== s.hostId) throw new Error("only the host");
  setPhase(s, "lobby", now, Number.POSITIVE_INFINITY);
  s.questions = [];
  s.index = 0;
  s.answers = {};
  s.party = undefined;
  return s;
}

export function ranking(s: RoomState): Player[] {
  return [...s.players].sort((a, b) => b.score - a.score);
}

export function roomCode(rng: () => number = Math.random): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 5 }, () => abc[Math.floor(rng() * abc.length)]).join("");
}

// ---------------------------------------------------------------------------
// What each player sees

export interface PublicPlayer {
  id: string;
  name: string;
  avatar?: string;
  color?: string;
  score: number;
  streak: number;
  answered: boolean;
  correct?: boolean;
  online: boolean;
  spectator?: boolean;
}

export interface PublicRoom<Q> {
  code: string;
  hostId: string;
  me: string;
  settings: RoomSettings;
  players: PublicPlayer[];
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  serverNow: number;
  index: number;
  total: number;
  question?: Q;
  hints?: { ar: string; en: string; cost: number }[];
  hintsLeft?: number;
  myAnswer?: AnswerState;
  reveal?: { title: string; titleAr?: string; sub?: string; image?: string; results: { id: string; points: number; correct: boolean; factor: number; breakdown?: ScoreBreakdown }[]; correctChoice?: string; correctOrder?: string[] };
  chat: ChatMessage[];
  party?: unknown;
  tag?: string;
  paused: boolean;
  /** how many players loaded the current question */
  loaded: number;
  aliasVote?: { by: string; text: string; yes: number; no: number; myVote?: boolean; status: AliasVote["status"] };
}

export function publicRoom<Q>(s: RoomState, me: string, now: number, present: (q: Question) => Q, imageUrl: (src: string) => string = (x) => x): PublicRoom<Q> {
  const q = currentQuestion(s);
  const reveal = s.phase === "reveal" || s.phase === "finished";
  const view: PublicRoom<Q> = {
    code: s.code,
    hostId: s.hostId,
    me,
    settings: s.settings,
    players: ranking(s).map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      color: p.color,
      score: p.score,
      streak: p.streak,
      answered: !!s.answers[p.id],
      correct: s.phase === "reveal" ? !!s.answers[p.id]?.correct : undefined,
      online: now - p.lastSeen < 20_000,
      spectator: !!p.spectator,
    })),
    paused: !!s.paused,
    loaded: s.loaded?.length ?? 0,
    phase: s.phase,
    phaseStartedAt: s.phaseStartedAt,
    phaseEndsAt: Number.isFinite(s.phaseEndsAt) ? s.phaseEndsAt : null,
    serverNow: now,
    index: s.index,
    total: s.questions.length,
    chat: s.chat.slice(-60),
    tag: s.tag,
  };
  if (s.aliasVote && s.phase === "reveal") {
    const v = s.aliasVote;
    view.aliasVote = { by: v.by, text: v.text, yes: v.yes.length, no: v.no.length, myVote: v.yes.includes(me) ? true : v.no.includes(me) ? false : undefined, status: v.status };
  }
  if (q) {
    view.question = present(q);
    const open = s.phase === "reveal" ? q.hints.length : hintsOpen(s, me, now);
    view.hints = q.hints.slice(0, open).map((h) => ({ ar: h.ar, en: h.en, cost: h.cost }));
    view.hintsLeft = s.settings.hints.enabled ? Math.max(0, Math.min(s.settings.hints.max, q.hints.length) - open) : 0;
    view.myAnswer = s.answers[me];
  }
  if (q && reveal) {
    view.reveal = {
      ...q.display,
      image: q.display.image ? imageUrl(q.display.image) : undefined,
      results: s.players.map((p) => ({ id: p.id, points: s.answers[p.id]?.points ?? 0, correct: !!s.answers[p.id]?.correct, factor: s.answers[p.id]?.factor ?? 0, breakdown: s.answers[p.id]?.breakdown })),
      correctChoice: q.correctChoice,
      correctOrder: q.correctOrder,
    };
  }
  return view;
}
