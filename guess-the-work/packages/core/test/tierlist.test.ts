import { describe, expect, it } from "vitest";
import { createRoom, join, DEFAULT_SETTINGS, type RoomState } from "../src/room";
import {
  TIER_ROWS,
  averageTier,
  decideVote,
  proximityPoints,
  valueTier,
  tierItems,
  itemById,
  startTierlist,
  voteTier,
  moveTier,
  agreeTier,
  pinTier,
  placeBoard,
  submitBoard,
  tickTier,
  appendTierItems,
  tierStats,
  tierView,
  personalRatings,
  tierArchive,
  type TierItem,
  type TierState,
  type TierSettings,
} from "../src/tierlist";
import { extendGame, endGame, tickPace, adjustGame, leaveGame, presetSettings } from "../src/pacing";
import { seeded } from "../src/rng";
import { makeLibrary } from "./fixtures";

const lib = makeLibrary();
const t0 = 9_000_000;
const items = (n: number, from = 0): TierItem[] => Array.from({ length: n }, (_, i) => ({ id: `w:x${i + from}`, workId: `x${i + from}`, kind: "work", title: `Item ${i + from}` }));

function room(tier: Partial<TierSettings>, n = 3, players = ["a", "b", "c"]) {
  const s = createRoom("T1", { id: players[0], name: players[0] }, { kind: "tierlist", count: n, tier: { ...DEFAULT_SETTINGS.tier, ...tier } }, t0);
  for (const p of players.slice(1)) join(s, { id: p, name: p }, t0);
  startTierlist(s, players[0], items(n), t0);
  return s;
}
const T = (s: RoomState) => s.party as TierState;
function run(s: RoomState, at: number) {
  for (let i = 0; i < 50; i++) {
    const before = `${s.phase}|${s.phaseEndsAt}|${T(s).index}`;
    tickPace(s, at);
    tickTier(s, at);
    if (before === `${s.phase}|${s.phaseEndsAt}|${T(s).index}`) break;
  }
}

describe("tier rules", () => {
  it("S=6 ... F=1, average rounded to the nearest tier", () => {
    expect(TIER_ROWS).toEqual(["S", "A", "B", "C", "D", "F"]);
    expect(valueTier(6)).toBe("S");
    expect(valueTier(1)).toBe("F");
    expect(averageTier(["S", "A", "A"])).toBe("A"); // 5.33
    expect(averageTier(["S", "B"])).toBe("A"); // 5
    expect(averageTier(["S", "F"])).toBe("B"); // 3.5 rounds up
    expect(averageTier([])).toBeNull();
  });
  it("proximity points: same 100, one off 50, two off 20, else 0", () => {
    expect(proximityPoints("A", "A")).toBe(100);
    expect(proximityPoints("A", "S")).toBe(50);
    expect(proximityPoints("A", "C")).toBe(20);
    expect(proximityPoints("S", "D")).toBe(0);
  });
  it("vote: majority, else the average, an exact half goes to the host", () => {
    expect(decideVote(["S", "S", "B"])).toEqual({ tier: "S", how: "majority" });
    expect(decideVote(["S", "A", "C"])).toEqual({ tier: "A", how: "average" }); // 4.67
    expect(decideVote(["S", "A"]).how).toBe("tie"); // 5.5
    expect(decideVote(["S", "S", "B", "B"]).how).toBe("average"); // 5, two-two without a majority
  });
});

describe("items", () => {
  it("topic filters and well-known first", () => {
    const anime = tierItems(lib, { type: "anime" }, { count: 5, rng: seeded(1) });
    expect(anime).toHaveLength(5);
    expect(anime.every((x) => x.kind === "work" && x.image)).toBe(true);
    const chars = tierItems(lib, { type: "character" }, { count: 3, rng: seeded(1) });
    expect(chars.every((x) => x.kind === "character")).toBe(true);
    const none = tierItems(lib, { type: "anime", yearFrom: 3000 }, { count: 5, rng: seeded(1) });
    expect(none).toHaveLength(0);
  });
  it("never repeats what is on the board", () => {
    const first = tierItems(lib, { type: "anime" }, { count: 5, rng: seeded(1) });
    const more = tierItems(lib, { type: "anime" }, { count: 5, rng: seeded(2), exclude: new Set(first.map((x) => x.id)) });
    expect(more.some((x) => first.some((y) => y.id === x.id))).toBe(false);
  });
  it("by id (manual picks and «عيدها»)", () => {
    const w = lib.works.find((x) => x.posterUrl)!;
    expect(itemById(lib, `w:${w.id}`)?.title).toBe(w.title);
    expect(itemById(lib, "w:nope")).toBeNull();
  });
});

describe("collective: secret vote", () => {
  it("a majority locks the tier; points by closeness; disagreements counted", () => {
    const s = room({ style: "vote" });
    voteTier(s, "a", "S", t0 + 10);
    voteTier(s, "b", "S", t0 + 10);
    expect(tierView(s, "c", (x) => x, (x) => x)!.votes).toBe(2);
    expect(tierView(s, "c", (x) => x, (x) => x)!.myVote).toBeUndefined(); // secret
    voteTier(s, "c", "B", t0 + 20);
    run(s, t0 + 700);
    expect(s.phase).toBe("tier_result");
    const r = T(s).results["w:x0"];
    expect(r.tier).toBe("S");
    expect(r.disagree).toBe(1);
    expect(s.players.find((p) => p.id === "a")!.score).toBe(100);
    expect(s.players.find((p) => p.id === "c")!.score).toBe(20);
  });
  it("an exact tie goes to the host; no answer = the average rounded up", () => {
    const s = room({ style: "vote" }, 3, ["a", "b"]);
    voteTier(s, "a", "S", t0);
    voteTier(s, "b", "A", t0);
    run(s, t0 + 700);
    expect(s.phase).toBe("tier_tiebreak");
    expect(() => pinTier(s, "b", "A", t0 + 800)).toThrow();
    pinTier(s, "a", "A", t0 + 800);
    expect(T(s).results["w:x0"]).toMatchObject({ tier: "A", how: "host" });
    const s2 = room({ style: "vote" }, 3, ["a", "b"]);
    voteTier(s2, "a", "S", t0);
    voteTier(s2, "b", "A", t0);
    run(s2, t0 + 700);
    run(s2, s2.phaseEndsAt + 1);
    expect(T(s2).results["w:x0"].tier).toBe("S");
  });
  it("nobody voted: the item stays unranked and the game goes on", () => {
    const s = room({ style: "vote" });
    run(s, s.phaseEndsAt + 1);
    expect(T(s).results["w:x0"].how).toBe("skipped");
    run(s, s.phaseEndsAt + 1);
    expect(s.phase).toBe("tier_item");
    expect(T(s).index).toBe(1);
  });
  it("after the last item: the ending screen; «زد» adds items to the same board", () => {
    const s = room({ style: "vote" }, 2);
    let t = t0;
    for (let i = 0; i < 6 && s.phase !== "ending"; i++) run(s, (t = s.phaseEndsAt + 1));
    expect(s.phase).toBe("ending");
    extendGame(s, "a", 5, t);
    expect(s.want).toBe(5);
    appendTierItems(s, items(5, 10), t);
    expect(s.phase).toBe("tier_item");
    expect(T(s).items).toHaveLength(7);
    expect(T(s).index).toBe(2);
  });
});

describe("collective: free discussion", () => {
  it("a move shows who moved it; a majority «موافق» locks it", () => {
    const s = room({ style: "discuss" });
    moveTier(s, "b", "A", t0 + 5);
    const v = tierView(s, "a", (x) => x, (x) => x)!;
    expect(v.placement).toMatchObject({ tier: "A", by: "b" });
    moveTier(s, "c", "B", t0 + 6); // moving again resets agreements
    expect(T(s).agrees).toEqual(["c"]);
    agreeTier(s, "a", t0 + 7);
    expect(s.phase).toBe("tier_result");
    expect(T(s).results["w:x0"]).toMatchObject({ tier: "B", disagree: 1 }); // b said A
  });
  it("the host «ثبّت» locks it where it is", () => {
    const s = room({ style: "discuss" });
    moveTier(s, "b", "C", t0 + 5);
    pinTier(s, "a", undefined, t0 + 6);
    expect(T(s).results["w:x0"]).toMatchObject({ tier: "C", how: "host" });
  });
  it("points are optional", () => {
    const off = room({ style: "discuss", points: false });
    moveTier(off, "b", "C", t0 + 5);
    agreeTier(off, "a", t0 + 6);
    expect(off.players.every((p) => p.score === 0)).toBe(true);
    const on = room({ style: "discuss", points: true });
    moveTier(on, "b", "C", t0 + 5);
    agreeTier(on, "a", t0 + 6);
    expect(on.players.find((p) => p.id === "b")!.score).toBe(100);
  });
});

describe("individual boards", () => {
  function solo() {
    const s = room({ style: "solo" });
    expect(s.phase).toBe("tier_board");
    // a: S A B, b: S B unseen, c: A A C
    for (const [u, b] of [["a", ["S", "A", "B"]], ["b", ["S", "B", "unseen"]], ["c", ["A", "A", "C"]]] as const) {
      b.forEach((tier, i) => placeBoard(s, u, `w:x${i}`, tier));
      submitBoard(s, u, t0 + 100);
    }
    return s;
  }
  it("boards are private until everybody is done, then the average board", () => {
    const s = room({ style: "solo" });
    placeBoard(s, "a", "w:x0", "S");
    expect(tierView(s, "b", (x) => x, (x) => x)!.boards).toBeUndefined();
    expect(tierView(s, "a", (x) => x, (x) => x)!.myBoard).toEqual({ "w:x0": "S" });
    placeBoard(s, "a", "w:x0", null);
    expect(T(s).boards.a).toEqual({});
  });
  it("«ما شفته» does not count; points by closeness to the average", () => {
    const s = solo();
    run(s, t0 + 800);
    expect(s.phase).toBe("tier_reveal");
    expect(T(s).board).toEqual({ "w:x0": "S", "w:x1": "A", "w:x2": "B" }); // x0: 5.67, x1: 4.67, x2: 3.5 (b unseen)
    expect(T(s).results["w:x2"].opinions).not.toHaveProperty("b");
    // a: S=S 100, A=A 100, B=B 100
    expect(s.players.find((p) => p.id === "a")!.score).toBe(300);
    const v = tierView(s, "b", (x) => x, (x) => x)!;
    expect(v.boards!.c).toBeTruthy();
    expect(v.stats!.aligned?.id).toBe("a");
  });
  it("the reveal ends in the ending screen", () => {
    const s = solo();
    run(s, t0 + 800);
    run(s, s.phaseEndsAt + 1);
    expect(s.phase).toBe("ending");
  });
  it("«زد» after the reveal: a second board with the new items only", () => {
    const s = solo();
    run(s, t0 + 800);
    run(s, s.phaseEndsAt + 1);
    extendGame(s, "a", 5, s.phaseStartedAt);
    appendTierItems(s, items(2, 20), s.phaseStartedAt);
    expect(s.phase).toBe("tier_board");
    expect(T(s).from).toBe(3);
    placeBoard(s, "a", "w:x0", "F"); // an old item: not on this board
    expect(T(s).boards.a["w:x0"]).toBe("S");
  });
  it("personal ratings feed the taste (unseen skipped)", () => {
    const s = solo();
    run(s, t0 + 800);
    const r = personalRatings(s);
    expect(r).toContainEqual({ userId: "b", workId: "x0", tier: "S" });
    expect(r.some((x) => x.userId === "b" && x.workId === "x2")).toBe(false);
  });
});

describe("«خمّن تير صاحبك»", () => {
  it("the friend's board is the truth; the others score by closeness", () => {
    const s = room({ style: "guess_friend", target: "b" });
    expect(T(s).target).toBe("b");
    ["S", "A", "F"].forEach((x, i) => placeBoard(s, "b", `w:x${i}`, x as "S"));
    ["S", "B", "F"].forEach((x, i) => placeBoard(s, "a", `w:x${i}`, x as "S"));
    ["C", "C", "C"].forEach((x, i) => placeBoard(s, "c", `w:x${i}`, x as "S"));
    for (const u of ["a", "b", "c"]) submitBoard(s, u, t0 + 10);
    run(s, t0 + 700);
    expect(T(s).board).toEqual({ "w:x0": "S", "w:x1": "A", "w:x2": "F" });
    expect(s.players.find((p) => p.id === "a")!.score).toBe(250);
    expect(s.players.find((p) => p.id === "b")!.score).toBe(0);
    expect(s.players.find((p) => p.id === "c")!.score).toBe(0 + 20 + 20); // C vs S is three off
  });
  it("needs two players; the friend leaving ends it", () => {
    expect(() => room({ style: "guess_friend" }, 3, ["a"])).toThrow();
    const s = room({ style: "guess_friend", target: "b" });
    leaveGame(s, "b", t0 + 5);
    expect(s.phase).toBe("finished");
  });
});

describe("end-of-night stats", () => {
  it("most aligned, the outlier, the most disputed and most agreed item", () => {
    const st = tierStats({
      results: {
        i1: { tier: "S", how: "majority", disagree: 1, opinions: { a: "S", b: "S", c: "F" } },
        i2: { tier: "A", how: "majority", disagree: 0, opinions: { a: "A", b: "A", c: "A" } },
      },
    });
    expect(st.aligned?.id).toBe("a");
    expect(st.outlier?.id).toBe("c");
    expect(st.disputed?.id).toBe("i1");
    expect(st.agreed?.id).toBe("i2");
  });
  it("the archive keeps items, the board, every opinion and the players", () => {
    const s = room({ style: "vote" }, 1);
    voteTier(s, "a", "B", t0);
    run(s, s.phaseEndsAt + 1);
    const a = tierArchive(s);
    expect(a.items.map((x) => x.id)).toEqual(["w:x0"]);
    expect(a.board).toEqual({ "w:x0": "B" });
    expect(a.players).toHaveLength(3);
  });
});

describe("pacing in the tier list", () => {
  it("presets: quick < normal < long", () => {
    expect(presetSettings("tierlist", "quick").count!).toBeLessThan(presetSettings("tierlist", "long").count!);
  });
  it("time change applies to the item on the table; «خلاص» closes it first", () => {
    const s = room({ style: "vote" });
    adjustGame(s, "a", { sec: 60 }, t0 + 1);
    expect(s.phaseEndsAt - s.phaseStartedAt).toBe(60_000);
    voteTier(s, "a", "A", t0 + 2);
    endGame(s, "a", t0 + 3);
    run(s, t0 + 4);
    expect(s.phase).toBe("finished");
    expect(T(s).results["w:x0"].tier).toBe("A");
  });
  it("remaining: fewer items drops the rest", () => {
    const s = room({ style: "vote" }, 6);
    adjustGame(s, "a", { remaining: 1 }, t0);
    expect(T(s).items).toHaveLength(2);
  });
});
