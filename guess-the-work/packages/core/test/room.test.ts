import { describe, expect, it } from "vitest";
import { createRoom, join, startGuess, submitAnswer, tick, requestHint, hintsOpen, publicRoom, skip, updateSettings, leave } from "../src/room";
import { generateQuestions } from "../src/generate";
import { seeded } from "../src/rng";
import { DEFAULT_TIER_MIX } from "../src/types";
import { makeLibrary } from "./fixtures";

const lib = makeLibrary();
const qs = () => generateQuestions(lib, { modes: ["poster"], count: 3, mix: DEFAULT_TIER_MIX, rng: seeded(9) });

function room(t0 = 1_000_000) {
  const s = createRoom("ABCDE", { id: "a", name: "Ali" }, { method: "both" }, t0);
  join(s, { id: "b", name: "Badr" }, t0);
  startGuess(s, "a", qs(), t0);
  begin(s, t0);
  return s;
}

/** everyone loaded: the clock of the current question starts at t */
function begin(s: ReturnType<typeof createRoom>, t: number) {
  s.phaseStartedAt = t;
  s.phaseEndsAt = t + 30_000;
}

describe("room", () => {
  it("only the host starts and changes settings", () => {
    const s = createRoom("X", { id: "a", name: "A" });
    join(s, { id: "b", name: "B" });
    expect(() => updateSettings(s, "b", { count: 3 })).toThrow();
    updateSettings(s, "a", { count: 3, hints: { enabled: false } as never });
    expect(s.settings.count).toBe(3);
    expect(s.settings.hints.max).toBe(4);
    expect(() => startGuess(s, "b", qs())).toThrow();
  });
  it("scores the faster player higher and moves on by the clock", () => {
    const t0 = 1_000_000;
    const s = room(t0);
    const q = s.questions[0];
    expect(submitAnswer(s, "a", { text: q.names[0] }, t0 + 2000).correct).toBe(true);
    expect(submitAnswer(s, "b", { text: q.names[0] }, t0 + 20000).correct).toBe(true);
    // both right: the question closes almost at once
    const ev = tick(s, t0 + 21000);
    expect(ev.closed).toBeTruthy();
    expect(s.phase).toBe("reveal");
    expect(s.players.find((p) => p.id === "a")!.score).toBeGreaterThan(s.players.find((p) => p.id === "b")!.score);
    tick(s, s.phaseEndsAt);
    expect(s.phase).toBe("question");
    expect(s.index).toBe(1);
    expect(s.phaseStartedAt).toBeGreaterThan(t0 + 21_000); // waits for the media again
  });
  it("does not freeze when a player disconnects", () => {
    const t0 = 1_000_000;
    const s = room(t0);
    submitAnswer(s, "a", { text: "wrong" }, t0 + 1000);
    // b never answers (gone)
    tick(s, t0 + 29_000);
    expect(s.phase).toBe("question");
    tick(s, t0 + 30_001);
    expect(s.phase).toBe("reveal");
    for (let i = 0; i < 10; i++) tick(s, s.phaseEndsAt);
    expect(s.phase).toBe("finished");
  });
  it("hints cost points and choices give fewer points", () => {
    const t0 = 1_000_000;
    const s = room(t0);
    const q = s.questions[0];
    requestHint(s, "a", t0);
    requestHint(s, "a", t0);
    expect(hintsOpen(s, "a", t0)).toBe(2);
    const withHints = submitAnswer(s, "a", { text: q.names[0] }, t0).points;
    const plain = submitAnswer(s, "b", { text: q.names[0] }, t0).points;
    expect(withHints).toBeLessThan(plain);
    const s2 = room(t0);
    submitAnswer(s2, "b", { choice: s2.questions[0].correctChoice }, t0);
    expect(s2.answers.b.breakdown?.method).toBe(0.5);
    expect(s.answers.a.breakdown?.bonus).toBe(0); // a hint cancels the rank bonus
    expect(s.answers.b.breakdown?.bonus).toBe(25); // second correct
  });
  it("a wrong choice is final, a wrong typed answer can be retried", () => {
    const t0 = 1_000_000;
    const s = room(t0);
    const q = s.questions[0];
    const wrong = q.choices!.find((c) => c.id !== q.correctChoice)!.id;
    expect(submitAnswer(s, "b", { choice: wrong }, t0).correct).toBe(false);
    expect(submitAnswer(s, "b", { choice: q.correctChoice }, t0).already).toBe(true);
    expect(submitAnswer(s, "a", { text: "nope" }, t0).correct).toBe(false);
    expect(submitAnswer(s, "a", { text: q.names[0] }, t0).correct).toBe(true);
  });
  it("answers after the time are refused, skip works, host moves on leave", () => {
    const t0 = 1_000_000;
    const s = room(t0);
    expect(submitAnswer(s, "a", { text: s.questions[0].names[0] }, t0 + 31_000).closed).toBe(true);
    skip(s, "a", t0 + 1000);
    expect(tick(s, t0 + 1000).closed).toBeTruthy(); // the clock closes it, so the answers get stored
    expect(s.phase).toBe("reveal");
    leave(s, "a");
    expect(s.hostId).toBe("b");
  });
  it("the public view never contains the answer before the reveal", () => {
    const t0 = 1_000_000;
    const s = room(t0);
    const q = s.questions[0];
    const v = publicRoom(s, "a", t0, (x) => ({ id: x.id }));
    const json = JSON.stringify(v);
    expect(json).not.toContain(q.correctChoice!);
    for (const n of q.names) if (n.length > 4) expect(json).not.toContain(n);
    tick(s, t0 + 31_000);
    expect(JSON.stringify(publicRoom(s, "a", t0 + 31_000, (x) => ({ id: x.id })))).toContain(q.display.title);
  });
});

describe("alias vote (اعتمد جوابي)", () => {
  it("adds the name when most of the others agree", async () => {
    const { proposeAlias, voteAlias } = await import("../src/room");
    const t0 = 1_000_000;
    const s = room(t0);
    join(s, { id: "c", name: "C" }, t0);
    submitAnswer(s, "b", { text: "my weird name" }, t0 + 100);
    tick(s, t0 + 31_000);
    expect(proposeAlias(s, "b", "my weird name", t0 + 31_000)).toBe(true);
    expect(voteAlias(s, "b", true)).toBeNull(); // not on your own
    const before = s.players.find((p) => p.id === "b")!.score;
    expect(voteAlias(s, "a", true)).toBeNull();
    const v = voteAlias(s, "c", true);
    expect(v?.status).toBe("accepted");
    expect(s.questions[0].names).toContain("my weird name");
    expect(s.players.find((p) => p.id === "b")!.score).toBeGreaterThan(before);
    expect(s.questions[0].entity?.kind).toBe("work");
  });
});

describe("scoring inside the room", () => {
  it("rank bonus, first-only and autocomplete picks", async () => {
    const { updateSettings } = await import("../src/room");
    const t0 = 1_000_000;
    const s = createRoom("R2", { id: "a", name: "A" }, {}, t0);
    join(s, { id: "b", name: "B" }, t0);
    join(s, { id: "c", name: "C" }, t0);
    updateSettings(s, "a", { firstOnly: true });
    startGuess(s, "a", qs(), t0);
    begin(s, t0);
    const q = s.questions[0];
    expect(submitAnswer(s, "b", { entityId: q.entity!.id }, t0).correct).toBe(true);
    expect(s.answers.b.breakdown?.bonus).toBe(50);
    expect(submitAnswer(s, "a", { text: q.names[0] }, t0 + 10).points).toBe(0);
    expect(submitAnswer(s, "c", { entityId: "anilist:999999" }, t0 + 10).correct).toBe(false);
  });
});
