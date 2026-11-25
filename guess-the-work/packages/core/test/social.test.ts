import { describe, expect, it } from "vitest";
import { buildSocialQuestions } from "../src/social";
import { checkAnswer } from "../src/questions";
import { createRoom, join, startGuess, submitAnswer } from "../src/room";
import { seeded } from "../src/rng";
import { makeLibrary } from "./fixtures";

const lib = makeLibrary();
const players = [
  { id: "a", name: "Ali" },
  { id: "b", name: "Badr" },
  { id: "c", name: "Chad" },
];
const log = [
  { userId: "a", workId: "anilist:0", status: "seen", rating: 9 },
  { userId: "b", workId: "anilist:0", status: "seen", rating: 6 },
  { userId: "a", workId: "anilist:1", status: "seen", rating: 3 },
  { userId: "c", workId: "anilist:2", status: "watching" },
];

describe("social modes", () => {
  it("«مين شافه؟»: pick people; those who saw it do not answer; scored by accuracy", () => {
    const qs = buildSocialQuestions(lib, { modes: ["who_watched"], count: 3, players, log, rng: seeded(1) });
    const q = qs.find((x) => x.workId === "anilist:0")!;
    expect(q.answerType).toBe("multi");
    expect(q.excluded?.sort()).toEqual(["a", "b"]);
    expect(q.choices!.map((c) => c.label).sort()).toEqual(["Ali", "Badr", "Chad"]);
    const id = (name: string) => q.choices!.find((c) => c.label === name)!.id;
    expect(checkAnswer(q, { picks: [id("Ali"), id("Badr")] })).toMatchObject({ correct: true, factor: 1 });
    expect(checkAnswer(q, { picks: [id("Ali")] }).factor).toBeCloseTo(0.5);
    expect(checkAnswer(q, { picks: [id("Chad")] }).factor).toBe(0);
  });
  it("«خمّن تقييمه»: the closer, the more points; the rater does not answer", () => {
    const qs = buildSocialQuestions(lib, { modes: ["guess_rating"], count: 2, players, log, rng: seeded(2) });
    const q = qs.find((x) => x.workId === "anilist:0" && x.excluded?.[0] === "a")!;
    expect(q.answerType).toBe("number");
    expect(q.promptAr).toContain("Ali");
    expect(checkAnswer(q, { number: 9 })).toMatchObject({ correct: true, factor: 1 });
    expect(checkAnswer(q, { number: 7 }).factor).toBeCloseTo(1 - 2 / 9);
    expect(checkAnswer(q, { number: 1 }).factor).toBeLessThan(0.2);
  });
  it("in the room: excluded players cannot answer and are not waited for", () => {
    const qs = buildSocialQuestions(lib, { modes: ["who_watched"], count: 1, players, log, rng: seeded(1) });
    const s = createRoom("S", players[0], {}, 0);
    join(s, players[1], 0);
    join(s, players[2], 0);
    startGuess(s, "a", qs, 0);
    s.phaseStartedAt = 0;
    s.phaseEndsAt = 30_000;
    const q = s.questions[0];
    for (const ex of q.excluded!) expect(submitAnswer(s, ex, { picks: [] }, 100).closed).toBe(true);
    const others = players.map((p) => p.id).filter((p) => !q.excluded!.includes(p));
    for (const o of others) submitAnswer(s, o, { picks: q.choices!.filter((c) => q.correctPicks!.includes(c.id)).map((c) => c.id) }, 200);
    expect(s.phaseEndsAt).toBeLessThan(30_000); // everyone who may answer did
  });
});

describe("«باقتي»", () => {
  it("builds the pack's questions with its difficulty", async () => {
    const { buildPackQuestions, modesForWork } = await import("../src/packs");
    expect(modesForWork(lib, "anilist:15", ["poster", "tags", "opening"])).toEqual(["poster", "tags"]);
    expect(modesForWork(lib, "anilist:3", ["opening"])).toEqual(["opening"]);
    const qs = buildPackQuestions(lib, { items: [{ workId: "anilist:3", mode: "poster" }, { workId: "anilist:4", mode: "tags" }, { workId: "nope", mode: "poster" }], difficulty: "hard" }, seeded(1));
    expect(qs.map((q) => q.workId).sort()).toEqual(["anilist:3", "anilist:4"]);
    expect(qs.every((q) => q.timeLimitMs === 15_000)).toBe(true);
  });
});
