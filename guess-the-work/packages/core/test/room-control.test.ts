import { describe, expect, it } from "vitest";
import { createRoom, join, kick, transferHost, pause, resume, becomePlayer, markLoaded, startGuess, submitAnswer, tick, publicRoom, PRELOAD_MAX_MS } from "../src/room";
import { generateQuestions } from "../src/generate";
import { seeded } from "../src/rng";
import { DEFAULT_TIER_MIX } from "../src/types";
import { makeLibrary } from "./fixtures";

const lib = makeLibrary();
const qs = () => generateQuestions(lib, { modes: ["poster"], count: 3, mix: DEFAULT_TIER_MIX, rng: seeded(9) });
const t0 = 5_000_000;

function room() {
  const s = createRoom("C1", { id: "a", name: "A" }, {}, t0);
  join(s, { id: "b", name: "B" }, t0);
  startGuess(s, "a", qs(), t0);
  return s;
}

describe("everyone loaded before the question starts", () => {
  it("waits for the media, at most PRELOAD_MAX_MS", () => {
    const s = room();
    expect(s.phaseStartedAt).toBe(t0 + PRELOAD_MAX_MS);
    expect(submitAnswer(s, "a", { text: s.questions[0].names[0] }, t0 + 100).closed).toBe(true);
    markLoaded(s, "a", s.questions[0].id, t0 + 300);
    expect(s.phaseStartedAt).toBe(t0 + PRELOAD_MAX_MS);
    markLoaded(s, "b", s.questions[0].id, t0 + 500);
    expect(s.phaseStartedAt).toBe(t0 + 500 + 1000);
    expect(s.phaseEndsAt - s.phaseStartedAt).toBe(30_000);
    expect(submitAnswer(s, "a", { text: s.questions[0].names[0] }, t0 + 1600).correct).toBe(true);
  });
  it("starts anyway when someone never loads", () => {
    const s = room();
    markLoaded(s, "a", s.questions[0].id, t0 + 100);
    expect(submitAnswer(s, "a", { text: s.questions[0].names[0] }, t0 + PRELOAD_MAX_MS + 1).correct).toBe(true);
  });
});

describe("host controls", () => {
  it("kick: gone and cannot come back", () => {
    const s = room();
    expect(() => kick(s, "b", "a")).toThrow();
    kick(s, "a", "b");
    expect(s.players.map((p) => p.id)).toEqual(["a"]);
    join(s, { id: "b", name: "B" }, t0);
    expect(s.players.map((p) => p.id)).toEqual(["a"]);
  });
  it("transfer host", () => {
    const s = room();
    transferHost(s, "a", "b");
    expect(s.hostId).toBe("b");
    expect(() => transferHost(s, "a", "b")).toThrow();
  });
  it("pause freezes the clock, resume gives the time back", () => {
    const s = room();
    for (const p of ["a", "b"]) markLoaded(s, p, s.questions[0].id, t0);
    const left = s.phaseEndsAt - (t0 + 11_000);
    pause(s, "a", t0 + 11_000);
    expect(s.paused).toBe(true);
    tick(s, t0 + 999_999);
    expect(s.phase).toBe("question");
    expect(submitAnswer(s, "b", { text: s.questions[0].names[0] }, t0 + 20_000).closed).toBe(true);
    resume(s, "a", t0 + 50_000);
    expect(s.phaseEndsAt).toBe(t0 + 50_000 + left);
  });
});

describe("rejoin and spectators", () => {
  it("a player who comes back keeps the points", () => {
    const s = room();
    s.players[1].score = 420;
    join(s, { id: "b", name: "B" }, t0 + 60_000);
    expect(s.players.find((p) => p.id === "b")!.score).toBe(420);
  });
  it("joining mid-game makes you a spectator until you ask to play", () => {
    const s = room();
    join(s, { id: "c", name: "C" }, t0);
    const c = s.players.find((p) => p.id === "c")!;
    expect(c.spectator).toBe(true);
    for (const p of ["a", "b"]) markLoaded(s, p, s.questions[0].id, t0);
    expect(s.phaseStartedAt).toBe(t0 + 1000); // the spectator is not waited for
    expect(submitAnswer(s, "c", { text: s.questions[0].names[0] }, t0 + 2000).closed).toBe(true);
    becomePlayer(s, "c");
    expect(c.spectator).toBe(false);
    expect(publicRoom(s, "c", t0, (q) => q.id).players.find((p) => p.id === "c")!.spectator).toBe(false);
  });
});

describe("settings merge", () => {
  it("a partial nested setting keeps the other fields", () => {
    const s = createRoom("M", { id: "a", name: "A" }, { describe: { turnSec: 25 } as never });
    expect(s.settings.describe).toMatchObject({ turnSec: 25, choose: true, via: "voice" });
  });
});
