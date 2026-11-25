import { describe, expect, it } from "vitest";
import { buildQuestion, candidatesFor, checkAnswer, MODES, publicQuestion, suggest } from "../src/questions";
import { seeded } from "../src/rng";
import { selectQuestions } from "../src/select";
import { DEFAULT_TIER_MIX } from "../src/types";
import { makeLibrary } from "./fixtures";

const lib = makeLibrary();

describe("every guessing mode builds questions", () => {
  for (const m of MODES) {
    it(m.id, () => {
      const cands = candidatesFor(m.id, lib);
      if (m.id === "ost") return expect(cands.length).toBe(0); // OSTs only come from the admin tool
      expect(cands.length).toBeGreaterThan(0);
      const rng = seeded(m.id);
      const chosen = selectQuestions(cands, { count: 3, mix: DEFAULT_TIER_MIX, rng });
      const qs = chosen.map((c) => buildQuestion(m.id, c, lib, { rng })).filter(Boolean);
      expect(qs.length).toBeGreaterThan(0);
      for (const q of qs) {
        const json = JSON.stringify(publicQuestion(q!, () => "/m/token", () => "/i/token", false));
        const withChoices = JSON.stringify(publicQuestion(q!, () => "/m/token", () => "/i/token", true));
        expect(withChoices).not.toMatch(/correct/i);
        // nothing that gives the answer away reaches the browser
        if (q!.answerType === "text") for (const n of q!.names) if (n.length > 3 && !["tags", "common_link"].includes(m.id)) expect(json).not.toContain(`"${n}"`);
        expect(json).not.toContain("img.test/p");
        expect(json).not.toMatch(/correct/i);
        expect(json).not.toContain("a.test");
      }
    });
  }
});

describe("checkAnswer", () => {
  const rng = seeded(7);
  const poster = buildQuestion("poster", candidatesFor("poster", lib)[5], lib, { rng })!;
  it("accepts any name of the work, typos, Arabic", () => {
    expect(checkAnswer(poster, { text: "work number 5 title" }).correct).toBe(true);
    expect(checkAnswer(poster, { text: "عمل رقم 5" }).correct).toBe(true);
    expect(checkAnswer(poster, { text: "work numbr 5 title" }).correct).toBe(true);
    expect(checkAnswer(poster, { text: "work number 6 title" }).correct).toBe(false);
  });
  it("accepts the right choice only", () => {
    expect(checkAnswer(poster, { choice: poster.correctChoice }).correct).toBe(true);
    expect(checkAnswer(poster, { choice: poster.choices!.find((c) => c.id !== poster.correctChoice)!.id }).correct).toBe(false);
    expect(poster.choices!.length).toBe(4);
  });
  it("gives part of the points for the work in character modes", () => {
    const q = buildQuestion("shadow", candidatesFor("shadow", lib)[0], lib, { rng })!;
    expect(checkAnswer(q, { text: "Hero0 Person0" })).toMatchObject({ correct: true, factor: 1 });
    expect(checkAnswer(q, { text: "Work Number 0 Title" })).toMatchObject({ correct: false, factor: 0.4 });
  });
  it("timeline: full order or half credit per right position", () => {
    const q = buildQuestion("timeline", candidatesFor("timeline", lib)[0], lib, { rng })!;
    expect(checkAnswer(q, { order: q.correctOrder })).toMatchObject({ correct: true, factor: 1 });
    expect(checkAnswer(q, { order: [...q.correctOrder!].reverse() }).correct).toBe(false);
  });
  it("plot hides the names", () => {
    const q = buildQuestion("plot", candidatesFor("plot", lib)[2], lib, { rng })!;
    expect(q.text).not.toMatch(/Hero2|Work Number 2/);
    expect(q.text).toContain("▇▇▇");
  });
  it("tags never show the title", () => {
    const q = buildQuestion("tags", candidatesFor("tags", lib)[1], lib, { rng })!;
    expect(JSON.stringify(q.items)).not.toContain("Work Number 1 Title");
  });
});

describe("suggest", () => {
  it("suggests from the whole library", () => {
    const s = suggest(lib, "work number 1");
    expect(s.length).toBeGreaterThan(3);
  });
});
