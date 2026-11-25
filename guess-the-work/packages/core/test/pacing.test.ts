import { describe, expect, it } from "vitest";
import { createRoom, join, startGuess, submitAnswer, tick, appendQuestions, DEFAULT_SETTINGS, type RoomState } from "../src/room";
import { PRESETS, presetSettings, applyPreset, detectPreset, extendGame, adjustGame, endGame, voteExtend, tickPace, leaveGame, rememberable, newRoundReady, ENDING_SEC, stepsFor } from "../src/pacing";
import * as describer from "../src/describer";
import * as drawer from "../src/drawer";
import { generateQuestions } from "../src/generate";
import { pickPartyItems } from "../src/party";
import { seeded } from "../src/rng";
import { DEFAULT_TIER_MIX } from "../src/types";
import { makeLibrary } from "./fixtures";

const lib = makeLibrary();
const gen = (n: number, seed = 9) => generateQuestions(lib, { modes: ["poster"], count: n, mix: DEFAULT_TIER_MIX, rng: seeded(seed) });
const t0 = 5_000_000;

function guessRoom(n = 3, settings: Partial<RoomState["settings"]> = {}, players = ["a", "b", "c"]) {
  const s = createRoom("P1", { id: players[0], name: players[0].toUpperCase() }, { count: n, ...settings }, t0);
  for (const p of players.slice(1)) join(s, { id: p, name: p.toUpperCase() }, t0);
  startGuess(s, players[0], gen(n), t0);
  return s;
}

/** runs the clock to `at`, step by step, like the server does */
function run(s: RoomState, at: number) {
  for (let i = 0; i < 200; i++) {
    const before = `${s.phase}|${s.index}|${s.phaseEndsAt}`;
    tickPace(s, at);
    tick(s, at);
    if (before === `${s.phase}|${s.index}|${s.phaseEndsAt}`) break;
  }
}

/** plays question after question until the room leaves question/reveal */
function playOut(s: RoomState, from: number) {
  let t = from;
  for (let i = 0; i < 50 && (s.phase === "question" || s.phase === "reveal"); i++) {
    t = Math.max(t, s.phaseEndsAt) + 1;
    run(s, t);
  }
  return t;
}

describe("presets", () => {
  it("every kind has quick < normal < long", () => {
    for (const kind of ["guess", "social", "describer", "camera", "drawer"] as const) {
      const q = presetSettings(kind, "quick");
      const n = presetSettings(kind, "normal");
      const l = presetSettings(kind, "long");
      expect(q.count!).toBeLessThanOrEqual(n.count!);
      expect(n.count!).toBeLessThanOrEqual(l.count!);
      expect(PRESETS[kind].quick).toBeTruthy();
    }
    expect(presetSettings("guess", "quick")).toMatchObject({ count: 5, timeLimitSec: 15 });
    expect(presetSettings("drawer", "long").draw?.drawSec).toBeGreaterThan(presetSettings("drawer", "quick").draw!.drawSec!);
  });
  it("defaults are the normal preset", () => {
    expect(detectPreset({ ...DEFAULT_SETTINGS })).toBe("normal");
  });
  it("detects a preset and falls back to custom", () => {
    const s = applyPreset({ ...DEFAULT_SETTINGS }, "quick");
    expect(detectPreset(s)).toBe("quick");
    expect(detectPreset({ ...s, timeLimitSec: 17 })).toBe("custom");
  });
  it("increments: questions +5/+10, party rounds +1/+2", () => {
    expect(stepsFor("guess")).toEqual([5, 10]);
    expect(stepsFor("drawer")).toEqual([1, 2]);
  });
  it("remembers only length, time and pace for the host", () => {
    const r = rememberable({ ...DEFAULT_SETTINGS, count: 7, timeLimitSec: 20, pace: { ...DEFAULT_SETTINGS.pace, open: true } });
    expect(r).toEqual({ count: 7, timeLimitSec: 20, describe: DEFAULT_SETTINGS.describe, draw: DEFAULT_SETTINGS.draw, camera: DEFAULT_SETTINGS.camera, pace: { ...DEFAULT_SETTINGS.pace, open: true } });
    expect(r).not.toHaveProperty("modes");
  });
});

describe("the end: «زد» / «خلاص» / new round", () => {
  it("after the last question the host gets the ending screen instead of an instant finish", () => {
    const s = guessRoom(2);
    const t = playOut(s, t0);
    expect(s.phase).toBe("ending");
    expect(s.phaseEndsAt).toBeLessThanOrEqual(t + ENDING_SEC * 1000);
  });
  it("nobody decides: the ending times out into the summary", () => {
    const s = guessRoom(2);
    playOut(s, t0);
    run(s, s.phaseEndsAt + 1);
    expect(s.phase).toBe("finished");
  });
  it("«خلاص» goes straight to the summary", () => {
    const s = guessRoom(2);
    const t = playOut(s, t0);
    expect(() => endGame(s, "b", t)).toThrow();
    endGame(s, "a", t);
    expect(s.phase).toBe("finished");
  });
  it("«زد +5»: five more questions, scores and streak carry on", () => {
    const s = guessRoom(2);
    let t = s.phaseStartedAt + 10;
    submitAnswer(s, "a", { text: s.questions[0].names[0] }, t);
    t = playOut(s, t);
    const score = s.players.find((p) => p.id === "a")!.score;
    expect(score).toBeGreaterThan(0);
    extendGame(s, "a", 5, t);
    expect(s.want).toBe(5);
    expect(s.settings.count).toBe(2); // the plan stays: a new round starts like the first
    appendQuestions(s, gen(5, 21), t);
    expect(s.phase).toBe("question");
    expect(s.index).toBe(2);
    expect(s.questions.length).toBe(7);
    expect(s.players.find((p) => p.id === "a")!.score).toBe(score);
    t = playOut(s, t);
    expect(s.phase).toBe("ending");
  });
  it("«زد» during the last question adds before the end", () => {
    const s = guessRoom(2);
    let t = s.phaseEndsAt + 1;
    run(s, t);
    t = s.phaseEndsAt + 1;
    run(s, t); // second question open
    expect(s.index).toBe(1);
    extendGame(s, "a", 10, t);
    appendQuestions(s, gen(10, 4), t);
    expect(s.questions.length).toBe(12);
    expect(s.phase).toBe("question");
  });
  it("only the host extends (without the vote)", () => {
    const s = guessRoom(2);
    const t = playOut(s, t0);
    expect(() => extendGame(s, "b", 5, t)).toThrow();
  });
  it("custom amounts are bounded", () => {
    const s = guessRoom(2);
    const t = playOut(s, t0);
    expect(() => extendGame(s, "a", 0, t)).toThrow();
    extendGame(s, "a", 500, t);
    expect(s.want).toBeLessThanOrEqual(50);
  });
  it("no more questions in the library: ends cleanly", () => {
    const s = guessRoom(2);
    const t = playOut(s, t0);
    extendGame(s, "a", 5, t);
    appendQuestions(s, [], t);
    expect(s.phase).toBe("finished");
  });
  it("new round is ready from the ending screen or the summary", () => {
    const s = guessRoom(2);
    const t = playOut(s, t0);
    expect(newRoundReady(s, "a")).toBe(true);
    expect(newRoundReady(s, "b")).toBe(false);
    endGame(s, "a", t);
    expect(newRoundReady(s, "a")).toBe(true);
  });
  it("pack rooms cannot be extended", () => {
    const s = guessRoom(2, { kind: "pack" });
    const t = playOut(s, t0);
    expect(() => extendGame(s, "a", 5, t)).toThrow();
  });
});

describe("open mode «مفتوح»", () => {
  it("asks for more questions before running out and never ends by itself", () => {
    const s = guessRoom(3, { pace: { ...DEFAULT_SETTINGS.pace, open: true } });
    expect(s.want).toBeGreaterThan(0); // 3 questions: already close to the end
    appendQuestions(s, gen(5, 3), t0);
    expect(s.want ?? 0).toBe(0);
    let t = t0;
    for (let i = 0; i < 6; i++) {
      t = s.phaseEndsAt + 1;
      run(s, t);
      if (s.want) appendQuestions(s, gen(s.want, 30 + i), t);
    }
    expect(["question", "reveal"]).toContain(s.phase);
    endGame(s, "a", t);
    run(s, t + 1);
    expect(s.phase).toBe("finished");
  });
  it("waits (in the reveal) while more questions are coming", () => {
    const s = guessRoom(1, { pace: { ...DEFAULT_SETTINGS.pace, open: true } });
    run(s, s.phaseEndsAt + 1);
    expect(s.phase).toBe("reveal");
    run(s, s.phaseEndsAt + 1);
    expect(s.phase).toBe("reveal");
    expect(s.want).toBeGreaterThan(0);
    appendQuestions(s, gen(2, 5), s.phaseEndsAt);
    run(s, s.phaseEndsAt + 1);
    expect(s.phase).toBe("question");
  });
});

describe("«خلاص» mid-game keeps the current question's points", () => {
  it("closes the question, then the summary", () => {
    const s = guessRoom(5);
    const t = s.phaseStartedAt + 100;
    submitAnswer(s, "a", { text: s.questions[0].names[0] }, t);
    endGame(s, "a", t + 1);
    run(s, t + 2);
    expect(s.phase).toBe("finished");
    expect(s.players.find((p) => p.id === "a")!.score).toBeGreaterThan(0);
  });
});

describe("vote to extend «تصويت على التمديد»", () => {
  const voted = () => guessRoom(2, { pace: { ...DEFAULT_SETTINGS.pace, extendVote: true } });
  it("a majority «زد» extends by the first step", () => {
    const s = voted();
    const t = playOut(s, t0);
    voteExtend(s, "a", true, t);
    expect(s.want ?? 0).toBe(0);
    voteExtend(s, "b", true, t);
    expect(s.want).toBe(5);
  });
  it("a majority «خلاص» ends", () => {
    const s = voted();
    const t = playOut(s, t0);
    voteExtend(s, "b", false, t);
    voteExtend(s, "c", false, t);
    expect(s.phase).toBe("finished");
  });
  it("time out: only a yes-majority extends", () => {
    const s = voted();
    const t = playOut(s, t0);
    voteExtend(s, "b", true, t);
    run(s, s.phaseEndsAt + 1);
    expect(s.phase).toBe("finished");
  });
  it("votes are ignored when the setting is off", () => {
    const s = guessRoom(2);
    const t = playOut(s, t0);
    voteExtend(s, "b", true, t);
    voteExtend(s, "c", true, t);
    expect(s.want ?? 0).toBe(0);
  });
});

describe("host changes time and length mid-game", () => {
  it("time: the current question and the next ones", () => {
    const s = guessRoom(4);
    const t = s.phaseStartedAt + 1000;
    adjustGame(s, "a", { sec: 60 }, t);
    expect(s.phaseEndsAt - s.phaseStartedAt).toBe(60_000);
    expect(s.settings.timeLimitSec).toBe(60);
    expect(s.questions.slice(1).every((q) => q.timeLimitMs === 60_000)).toBe(true);
    adjustGame(s, "a", { sec: 5 }, t);
    expect(s.phaseEndsAt).toBeGreaterThanOrEqual(t + 3000); // never cuts a question off under players' feet
  });
  it("remaining: fewer drops questions, more asks for them", () => {
    const s = guessRoom(6);
    adjustGame(s, "a", { remaining: 2 }, t0);
    expect(s.questions.length).toBe(3);
    adjustGame(s, "a", { remaining: 5 }, t0);
    expect(s.want).toBe(3);
    expect(() => adjustGame(s, "b", { remaining: 1 }, t0)).toThrow();
  });
});

describe("leaving mid-game", () => {
  it("the game goes on; one player left turns it into solo", () => {
    const s = guessRoom(3);
    leaveGame(s, "b", t0);
    expect(s.phase).toBe("question");
    leaveGame(s, "c", t0);
    expect(s.phase).toBe("question");
    expect(s.chat.at(-1)?.text).toContain("فردي");
  });
  it("the host leaves: the next player hosts", () => {
    const s = guessRoom(3);
    leaveGame(s, "a", t0);
    expect(s.hostId).toBe("b");
  });
  it("party mode with one player left ends", () => {
    const s = createRoom("D1", { id: "a", name: "A" }, { kind: "describer" }, t0);
    join(s, { id: "b", name: "B" }, t0);
    describer.startDescriber(s, "a", t0);
    leaveGame(s, "b", t0);
    expect(s.phase).toBe("finished");
  });
  it("the describer leaves during their turn: next turn, nobody else changes", () => {
    const s = createRoom("D2", { id: "a", name: "A" }, { kind: "describer" }, t0);
    join(s, { id: "b", name: "B" }, t0);
    join(s, { id: "c", name: "C" }, t0);
    describer.startDescriber(s, "a", t0);
    describer.giveItems(s, pickPartyItems(lib, 2, { mix: DEFAULT_TIER_MIX, rng: seeded(2) }, "describer"), t0);
    describer.choose(s, "a", 0, t0);
    expect(describer.describerId(s)).toBe("a");
    leaveGame(s, "a", t0 + 10);
    expect(s.phase).toBe("describe_choose");
    expect(describer.describerId(s)).toBe("b");
  });
  it("someone else leaves: the describer stays the same", () => {
    const s = createRoom("D3", { id: "a", name: "A" }, { kind: "describer" }, t0);
    for (const p of ["b", "c"]) join(s, { id: p, name: p }, t0);
    describer.startDescriber(s, "a", t0);
    describer.giveItems(s, pickPartyItems(lib, 2, { mix: DEFAULT_TIER_MIX, rng: seeded(2) }, "describer"), t0);
    describer.choose(s, "a", 0, t0);
    describer.tickDescriber(s, s.phaseEndsAt + 1);
    describer.tickDescriber(s, s.phaseEndsAt + 1); // b's turn now
    expect(describer.describerId(s)).toBe("b");
    leaveGame(s, "a", s.phaseStartedAt + 1);
    expect(describer.describerId(s)).toBe("b");
  });
});

describe("party modes: rounds, «زد» and open", () => {
  function draw(count = 1, settings: Partial<RoomState["settings"]> = {}) {
    const s = createRoom("R1", { id: "a", name: "A" }, { kind: "drawer", count, draw: { ...DEFAULT_SETTINGS.draw, choose: false }, ...settings }, t0);
    join(s, { id: "b", name: "B" }, t0);
    drawer.startDrawer(s, "a", drawer.pickDrawItems(lib, 2, { mix: DEFAULT_TIER_MIX, rng: seeded(3) }), t0);
    return s;
  }
  function finishRound(s: RoomState) {
    drawer.submit(s, "a", `d-${s.phaseStartedAt}-a`, s.phaseStartedAt + 1);
    drawer.submit(s, "b", `d-${s.phaseStartedAt}-b`, s.phaseStartedAt + 1);
    const evs = [drawer.tickDrawer(s, s.phaseEndsAt + 1)]; // drawing time is over
    for (let i = 0; i < 10 && !["ending", "finished", "draw"].includes(s.phase); i++) evs.push(drawer.tickDrawer(s, s.phaseEndsAt + 1));
    return evs;
  }
  it("the drawer plays `count` rounds, then the ending screen", () => {
    const s = draw(2);
    const evs = finishRound(s);
    expect(evs.some((e) => e.voted)).toBe(true);
    expect(s.phase).toBe("draw");
    expect(drawer.tickDrawer(s, s.phaseStartedAt + 1).needItems).toBe(true);
    drawer.giveRound(s, drawer.pickDrawItems(lib, 2, { mix: DEFAULT_TIER_MIX, rng: seeded(4) }), s.phaseStartedAt + 2);
    finishRound(s);
    expect(s.phase).toBe("ending");
  });
  it("«زد» in the drawer adds rounds", () => {
    const s = draw(1);
    finishRound(s);
    expect(s.phase).toBe("ending");
    extendGame(s, "a", 1, s.phaseStartedAt);
    expect(s.phase).toBe("draw");
    expect(drawer.tickDrawer(s, s.phaseStartedAt + 1).needItems).toBe(true);
  });
  it("«زد» in the describer adds a round for everyone", () => {
    const s = createRoom("D4", { id: "a", name: "A" }, { kind: "describer", count: 1 }, t0);
    join(s, { id: "b", name: "B" }, t0);
    describer.startDescriber(s, "a", t0);
    let t = t0;
    for (let i = 0; i < 40 && s.phase !== "ending"; i++) {
      t = s.phaseEndsAt + 1;
      const ev = describer.tickDescriber(s, t);
      if (ev.needItems) describer.giveItems(s, pickPartyItems(lib, 2, { mix: DEFAULT_TIER_MIX, rng: seeded(i) }, "describer"), t);
    }
    expect(s.phase).toBe("ending");
    extendGame(s, "a", 1, t);
    expect(s.phase).toBe("describe_choose");
    expect((s.party as describer.DescriberState).totalTurns).toBe(4);
  });
  it("open describer never ends by itself", () => {
    const s = createRoom("D5", { id: "a", name: "A" }, { kind: "describer", count: 1, pace: { ...DEFAULT_SETTINGS.pace, open: true } }, t0);
    join(s, { id: "b", name: "B" }, t0);
    describer.startDescriber(s, "a", t0);
    let t = t0;
    for (let i = 0; i < 60; i++) {
      t = s.phaseEndsAt + 1;
      const ev = describer.tickDescriber(s, t);
      if (ev.needItems) describer.giveItems(s, pickPartyItems(lib, 2, { mix: DEFAULT_TIER_MIX, rng: seeded(i) }, "describer"), t);
    }
    expect(s.phase).not.toBe("finished");
    expect(s.phase).not.toBe("ending");
  });
  it("time change applies to the running turn", () => {
    const s = createRoom("D6", { id: "a", name: "A" }, { kind: "describer" }, t0);
    join(s, { id: "b", name: "B" }, t0);
    describer.startDescriber(s, "a", t0);
    describer.giveItems(s, pickPartyItems(lib, 2, { mix: DEFAULT_TIER_MIX, rng: seeded(2) }, "describer"), t0);
    describer.choose(s, "a", 0, t0);
    adjustGame(s, "a", { sec: 120 }, t0 + 5);
    expect(s.phaseEndsAt - s.phaseStartedAt).toBe(120_000);
    expect(s.settings.describe.turnSec).toBe(120);
    adjustGame(s, "a", { remaining: 0 }, t0 + 6);
    expect((s.party as describer.DescriberState).totalTurns).toBe(1);
  });
});
