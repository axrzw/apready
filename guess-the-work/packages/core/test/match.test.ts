import { describe, expect, it } from "vitest";
import { normalize, matchAnswer, findNames, redactNames, leaksAnswer, maxDistance } from "../src/match";

const aot = ["Attack on Titan", "Shingeki no Kyojin", "進撃の巨人", "هجوم العمالقة", "AoT"];
const tsubasaWork = ["Captain Tsubasa", "キャプテン翼", "كابتن ماجد"];
const tsubasaChar = ["Tsubasa Ozora", "Ozora Tsubasa", "Tsubasa", "大空翼", "ماجد", "ماجد عبدالله"];

describe("normalize", () => {
  it("unifies Arabic letters and strips diacritics and tatweel", () => {
    expect(normalize("أإآ")).toBe("ااا");
    expect(normalize("مدرسة")).toBe("مدرسه");
    expect(normalize("مصطفى")).toBe("مصطفي");
    expect(normalize("هُجُوم الـعَمالِقة")).toBe("هجوم العمالقه");
  });
  it("lowercases English, drops punctuation and accents", () => {
    expect(normalize("Re:Zero − Starting Life!")).toBe("re zero starting life");
    expect(normalize("Pokémon")).toBe("pokemon");
    expect(normalize("Fate/stay night")).toBe("fate stay night");
  });
  it("unifies seasons", () => {
    expect(normalize("Attack on Titan Season 2")).toBe("attack on titan s2");
    expect(normalize("Attack on Titan 2nd Season")).toBe("attack on titan s2");
    expect(normalize("Overlord II")).toBe("overlord s2");
    expect(normalize("Mob Psycho 100 III")).toBe("mob psycho 100 s3");
    expect(normalize("Demon Slayer Part 2")).toBe("demon slayer s2");
    expect(normalize("الموسم الثاني")).toBe("s2");
  });
  it("turns Arabic-Indic digits into Latin", () => {
    expect(normalize("موب سايكو ١٠٠")).toBe("موب سايكو 100");
  });
});

describe("matchAnswer", () => {
  it("accepts every name of Attack on Titan", () => {
    for (const a of ["هجوم العمالقة", "هجوم العمالقه", "هُجوم العمالقة", "Attack on Titan", "attack on titan", "Shingeki no Kyojin", "shingeki no kyoujin", "AoT", "進撃の巨人"]) {
      expect(matchAnswer(a, aot).ok, a).toBe(true);
    }
  });
  it("accepts Captain Tsubasa / كابتن ماجد", () => {
    expect(matchAnswer("كابتن ماجد", tsubasaWork).ok).toBe(true);
    expect(matchAnswer("captain tsubasa", tsubasaWork).ok).toBe(true);
    expect(matchAnswer("كابتين ماجد", tsubasaWork).ok).toBe(true);
  });
  it("maps ماجد to Tsubasa Ozora", () => {
    const r = matchAnswer("ماجد", tsubasaChar);
    expect(r.ok).toBe(true);
    expect(matchAnswer("tsubasa ozora", tsubasaChar).ok).toBe(true);
  });
  it("accepts common typos", () => {
    for (const a of ["atack on titan", "attack on titen", "shingeki no kyogin", "هجوم العملاقة", "captian tsubasa"]) {
      expect(matchAnswer(a, [...aot, ...tsubasaWork]).ok, a).toBe(true);
    }
  });
  it("accepts the season suffix on a work", () => {
    expect(matchAnswer("Attack on Titan season 3", aot).ok).toBe(true);
    expect(matchAnswer("هجوم العمالقة الموسم الثاني", aot).ok).toBe(true);
  });
  it("rejects different short names", () => {
    expect(matchAnswer("K", ["Ao"]).ok).toBe(false);
    expect(matchAnswer("Ai", ["Ao"]).ok).toBe(false);
    expect(matchAnswer("ماجده", ["ماجد"]).ok).toBe(false);
    expect(matchAnswer("Naruto", ["Haruto"]).ok).toBe(false);
    expect(matchAnswer("Bleach", ["Beach"]).ok).toBe(false);
  });
  it("rejects unrelated answers and empty input", () => {
    expect(matchAnswer("One Piece", aot).ok).toBe(false);
    expect(matchAnswer("", aot).ok).toBe(false);
    expect(matchAnswer("   ", aot).ok).toBe(false);
    expect(matchAnswer("attack", aot).ok).toBe(false);
  });
  it("scales the threshold with length", () => {
    expect(maxDistance(3)).toBe(0);
    expect(maxDistance(5)).toBe(0);
    expect(maxDistance(8)).toBe(1);
    expect(maxDistance(14)).toBe(2);
    expect(maxDistance(30)).toBe(4);
  });
});

describe("findNames / redact / leaks", () => {
  it("redacts names in a synopsis (also in Arabic and with the article)", () => {
    const text = "Eren Yeager vows to kill every Titan after Eren's mother dies.";
    const out = redactNames(text, ["Eren Yeager", "Eren Jaeger"], "▇");
    expect(out).not.toMatch(/Eren/);
    expect(out).toMatch(/Titan/);
  });
  it("redacts the work title inside the text", () => {
    const out = redactNames("In Attack on Titan, humans live behind walls.", aot, "▇");
    expect(out).toBe("In ▇, humans live behind walls.");
  });
  it("finds forbidden words with typos and Arabic variants", () => {
    expect(findNames("شخصية من كابتن ماجد", tsubasaWork).length).toBe(1);
    expect(findNames("he is like tsubasaa", tsubasaChar).length).toBe(1);
    expect(findNames("a story about football", tsubasaChar).length).toBe(0);
  });
  it("detects a hint that leaks the answer", () => {
    expect(leaksAnswer("Studio: Captain Tsubasa Productions", tsubasaWork)).toBe(true);
    expect(leaksAnswer("Studio: Wit Studio", aot)).toBe(false);
  });
});

describe("numbers", () => {
  it("never fuzzy-matches a different number", () => {
    expect(matchAnswer("Mob Psycho 10", ["Mob Psycho 100"]).ok).toBe(false);
    expect(matchAnswer("Steins Gate 0", ["Steins Gate"]).ok).toBe(false);
    expect(matchAnswer("mob psyco 100", ["Mob Psycho 100"]).ok).toBe(true);
  });
});

describe("loose Arabic (article and small words)", () => {
  it("accepts names that differ by «ال» or «على/في/من»", () => {
    expect(matchAnswer("هجوم العمالقة", ["الهجوم على العمالقة"]).ok).toBe(true);
    expect(matchAnswer("محقق كونان", ["المحقق كونان"]).ok).toBe(true);
    expect(matchAnswer("the promised neverland", ["Promised Neverland"]).ok).toBe(true);
  });
  it("still rejects different names", () => {
    expect(matchAnswer("ماجده", ["ماجد"]).ok).toBe(false);
    expect(matchAnswer("هجوم", ["الهجوم على العمالقة"]).ok).toBe(false);
    expect(matchAnswer("العمالقة", ["الهجوم على العمالقة"]).ok).toBe(false);
  });
});
