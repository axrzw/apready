import type { RoomKind, RoomSettings, RoomState } from "./room";
import { ENDING_SEC, OPEN_BATCH, QUESTION_KINDS, finishGame, leave, mergeSettings, systemMsg } from "./room";
import * as describer from "./describer";
import * as drawer from "./drawer";

export { ENDING_SEC, OPEN_BATCH };

/**
 * Length and time for every mode (SPEC «شاشة الإعداد»): «سريعة / عادية / طويلة / مخصص», plus «مفتوح».
 * The host's last choice per mode is remembered (`rememberable`).
 */
export type PresetId = "quick" | "normal" | "long";
export type PresetChoice = PresetId | "custom";
export const PRESET_IDS: PresetId[] = ["quick", "normal", "long"];
export const PRESET_AR: Record<PresetChoice, string> = { quick: "سريعة", normal: "عادية", long: "طويلة", custom: "مخصص" };

export interface PacePatch {
  count?: number;
  timeLimitSec?: number;
  describe?: Partial<RoomSettings["describe"]>;
  draw?: Partial<RoomSettings["draw"]>;
  camera?: Partial<RoomSettings["camera"]>;
}

export const PRESETS: Record<RoomKind, Record<PresetId, PacePatch>> = {
  guess: { quick: { count: 5, timeLimitSec: 15 }, normal: { count: 10, timeLimitSec: 30 }, long: { count: 20, timeLimitSec: 45 } },
  social: { quick: { count: 5, timeLimitSec: 15 }, normal: { count: 10, timeLimitSec: 25 }, long: { count: 15, timeLimitSec: 40 } },
  pack: { quick: { timeLimitSec: 15 }, normal: { timeLimitSec: 30 }, long: { timeLimitSec: 45 } },
  describer: { quick: { count: 1, describe: { turnSec: 50 } }, normal: { count: 2, describe: { turnSec: 75 } }, long: { count: 3, describe: { turnSec: 100 } } },
  camera: {
    quick: { count: 1, describe: { turnSec: 50 }, camera: { setupSec: 20 } },
    normal: { count: 2, describe: { turnSec: 75 }, camera: { setupSec: 30 } },
    long: { count: 3, describe: { turnSec: 100 }, camera: { setupSec: 40 } },
  },
  drawer: {
    quick: { count: 1, draw: { drawSec: 60, guessSec: 20, voteSec: 25 } },
    normal: { count: 1, draw: { drawSec: 90, guessSec: 30, voteSec: 40 } },
    long: { count: 2, draw: { drawSec: 150, guessSec: 40, voteSec: 60 } },
  },
};

export function presetSettings(kind: RoomKind, preset: PresetId): PacePatch {
  return PRESETS[kind][preset];
}

/** Settings with a preset applied (the nested objects keep their other fields). */
export function applyPreset(s: RoomSettings, preset: PresetId): RoomSettings {
  return mergeSettings(s, presetSettings(s.kind, preset) as Partial<RoomSettings>);
}

function matches(s: RoomSettings, p: PacePatch): boolean {
  if (p.count !== undefined && s.count !== p.count) return false;
  if (p.timeLimitSec !== undefined && s.timeLimitSec !== p.timeLimitSec) return false;
  for (const k of ["describe", "draw", "camera"] as const) {
    const sub = p[k] as Record<string, unknown> | undefined;
    if (sub && Object.entries(sub).some(([f, v]) => (s[k] as Record<string, unknown>)[f] !== v)) return false;
  }
  return true;
}

/** Which preset these settings are, or «مخصص». */
export function detectPreset(s: RoomSettings): PresetChoice {
  return PRESET_IDS.find((id) => matches(s, PRESETS[s.kind][id])) ?? "custom";
}

/** What is remembered per host and mode: length, time and pace, nothing else. */
export function rememberable(s: RoomSettings): Pick<RoomSettings, "count" | "timeLimitSec" | "describe" | "draw" | "camera" | "pace"> {
  return { count: s.count, timeLimitSec: s.timeLimitSec, describe: s.describe, draw: s.draw, camera: s.camera, pace: s.pace };
}

const isQuestions = (s: RoomState) => QUESTION_KINDS.includes(s.settings.kind);
const isDescriber = (s: RoomState) => s.settings.kind === "describer" || s.settings.kind === "camera";

/** «زد» amounts: questions for guessing rooms, rounds for party modes. */
export function stepsFor(kind: RoomKind): [number, number] {
  return kind === "guess" || kind === "social" || kind === "pack" ? [5, 10] : [1, 2];
}

const MAX_EXTEND = 50;
const running = (s: RoomState) => s.phase !== "lobby" && s.phase !== "finished";

function hostOnly(s: RoomState, by: string | null) {
  if (by !== null && by !== s.hostId) throw new Error("only the host");
}

/**
 * «زد»: more questions (or rounds) with the same settings; points and streaks carry on.
 * The settings keep the planned length, so «جولة جديدة بنفس الإعدادات» starts like the first.
 * Works while playing and on the ending screen. `by` null = the players' vote.
 */
export function extendGame(s: RoomState, by: string | null, n: number, now = Date.now()) {
  hostOnly(s, by);
  if (!running(s)) throw new Error("اللعبة مو شغّالة");
  if (s.settings.kind === "pack") throw new Error("الباقة أسئلتها ثابتة");
  if (!Number.isFinite(n) || n < 1) throw new Error("كم تبي تزيد؟");
  n = Math.min(MAX_EXTEND, Math.round(n));
  const atEnd = s.phase === "ending";
  if (isQuestions(s)) {
    s.noMore = false;
    s.want = Math.min(MAX_EXTEND, (s.want ?? 0) + n);
    if (atEnd) {
      s.ending = { votes: {}, extending: true };
      s.phaseEndsAt = now + 60_000; // if the questions never come, the summary
    }
  } else if (isDescriber(s)) {
    const d = s.party as describer.DescriberState;
    d.totalTurns += n * Math.max(1, s.players.filter((p) => !p.spectator && d.order.includes(p.id)).length);
    if (atEnd) describer.resumeTurns(s, now);
  } else {
    const d = s.party as drawer.DrawerState;
    d.rounds = drawer.roundsOf(s) + n;
    if (atEnd) drawer.nextRound(s, now);
  }
  systemMsg(s, isQuestions(s) ? `زدنا ${n} أسئلة` : `زدنا ${n === 1 ? "جولة" : `${n} جولات`}`, now);
}

/** «جولة جديدة بنفس الإعدادات» is offered on the ending screen and the summary. */
export function newRoundReady(s: RoomState, uid: string): boolean {
  return uid === s.hostId && (s.phase === "ending" || s.phase === "finished");
}

/** «خلاص»: to the summary. A running question (or turn, or vote) closes first so its points count. */
export function endGame(s: RoomState, by: string, now = Date.now()) {
  hostOnly(s, by);
  if (s.phase === "lobby") throw new Error("اللعبة ما بدت");
  if (s.phase === "finished") return;
  const closeFirst = (isQuestions(s) && (s.phase === "question" || s.phase === "reveal")) || (isDescriber(s) && (s.phase === "describe_turn" || s.phase === "describe_reveal")) || s.phase === "draw_vote";
  if (!closeFirst) {
    finishGame(s, now);
    systemMsg(s, "خلصت اللعبة", now);
    return;
  }
  s.stopping = true;
  s.want = 0;
  s.phaseEndsAt = now;
  if (s.phaseStartedAt > now) s.phaseStartedAt = now;
}

/** The host changes the time (current question / turn too) or how many are left, at any time. */
export function adjustGame(s: RoomState, by: string, patch: { sec?: number; remaining?: number }, now = Date.now()) {
  hostOnly(s, by);
  if (!running(s)) throw new Error("اللعبة مو شغّالة");
  if (patch.sec !== undefined) {
    const sec = Math.max(5, Math.min(600, Math.round(patch.sec)));
    const stretch = (phase: RoomState["phase"]) => {
      if (s.phase === phase) s.phaseEndsAt = Math.max(now + 3000, s.phaseStartedAt + sec * 1000);
    };
    if (isQuestions(s)) {
      s.settings.timeLimitSec = sec;
      for (const q of s.questions.slice(s.index)) q.timeLimitMs = sec * 1000;
      stretch("question");
    } else if (isDescriber(s)) {
      s.settings.describe.turnSec = sec;
      stretch("describe_turn");
    } else {
      s.settings.draw.drawSec = sec;
      stretch("draw");
    }
  }
  if (patch.remaining !== undefined) {
    const r = Math.max(0, Math.min(MAX_EXTEND, Math.round(patch.remaining)));
    if (isQuestions(s)) {
      const total = s.index + 1 + r;
      if (total <= s.questions.length) {
        s.questions = s.questions.slice(0, total);
        s.want = 0;
      } else {
        if (s.settings.kind === "pack") throw new Error("الباقة أسئلتها ثابتة");
        s.want = total - s.questions.length;
        s.noMore = false;
      }
    } else if (isDescriber(s)) {
      const d = s.party as describer.DescriberState;
      d.totalTurns = d.turn + 1 + r;
    } else {
      const d = s.party as drawer.DrawerState;
      d.rounds = (d.round ?? 0) + 1 + r;
    }
    s.settings.pace = { ...s.settings.pace, open: false };
  }
}

/** «تصويت على التمديد»: on the ending screen, the majority says «زد» or «خلاص». */
export function voteExtend(s: RoomState, uid: string, yes: boolean, now = Date.now()) {
  if (s.phase !== "ending" || !s.settings.pace?.extendVote || !s.ending || s.ending.extending) return;
  const voters = s.players.filter((p) => !p.spectator);
  if (!voters.some((p) => p.id === uid)) return;
  s.ending.votes[uid] = yes;
  const v = Object.values(s.ending.votes);
  const half = voters.length / 2;
  if (v.filter(Boolean).length > half) {
    if (s.settings.kind === "pack") finishGame(s, now);
    else extendGame(s, null, stepsFor(s.settings.kind)[0], now);
  } else if (v.filter((x) => !x).length > half) {
    finishGame(s, now);
    systemMsg(s, "الأغلبية قالوا خلاص", now);
  }
}

/** The ending screen times out into the summary. Returns true when the game finished. */
export function tickPace(s: RoomState, now = Date.now()): boolean {
  if (s.phase !== "ending" || now < s.phaseEndsAt) return false;
  finishGame(s, now);
  return true;
}

/**
 * A player leaves mid-game. Guessing goes on (one player left = solo); party modes need two.
 * A describer who leaves mid-turn hands the turn on without points.
 */
export function leaveGame(s: RoomState, uid: string, now = Date.now()) {
  const wasRunning = running(s);
  const before = s.players.filter((p) => !p.spectator).length;
  let wasDescriber = false;
  if (wasRunning && isDescriber(s) && s.party) {
    const d = s.party as describer.DescriberState;
    d.current = describer.describerId(s);
    wasDescriber = d.current === uid;
  }
  leave(s, uid, now);
  if (!wasRunning) return;
  const playing = s.players.filter((p) => !p.spectator);
  if (!playing.length) {
    finishGame(s, now);
    return;
  }
  if (!isQuestions(s) && playing.length < 2) {
    systemMsg(s, "ما بقى إلا لاعب واحد، خلصت اللعبة", now);
    finishGame(s, now);
    return;
  }
  if (isQuestions(s) && playing.length === 1 && before > 1) systemMsg(s, "صارت اللعبة فردية", now);
  if (wasDescriber && ["describe_choose", "camera_setup", "camera_confirm", "describe_turn"].includes(s.phase)) describer.abortTurn(s, now);
}
