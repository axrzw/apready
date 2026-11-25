import { describe, expect, it } from "vitest";
import { createRoom, join } from "../src/room";
import * as D from "../src/describer";
import * as R from "../src/drawer";
import { seeded } from "../src/rng";
import { DEFAULT_TIER_MIX } from "../src/types";
import { makeLibrary } from "./fixtures";

const lib = makeLibrary();
const opts = () => ({ mix: DEFAULT_TIER_MIX, rng: seeded(11) });

function room(kind: "describer" | "drawer") {
  const s = createRoom("P1", { id: "a", name: "Ali" }, { kind, count: 1 }, 0);
  join(s, { id: "b", name: "Badr" }, 0);
  join(s, { id: "c", name: "Chad" }, 0);
  return s;
}

describe("describer", () => {
  it("gives the item only to the describer, masks forbidden words, scores guessers and describer", () => {
    const s = room("describer");
    D.startDescriber(s, "a", 0);
    expect(D.tickDescriber(s, 1).needItems).toBe(true);
    D.giveItems(s, D.pickItems(lib, 2, opts()), 1);
    const descr = D.describerId(s)!;
    expect(s.phase).toBe("describe_choose");
    D.choose(s, descr, 1, 2);
    expect(s.phase).toBe("describe_turn");
    const tok = (r: { users?: string[] }) => `tok-${(r.users ?? []).join(",")}`;
    const mine = D.describerView(s, descr, tok, (x) => x)!;
    const other = D.describerView(s, descr === "b" ? "c" : "b", tok, (x) => x)!;
    expect(mine.item?.forbidden.length).toBeGreaterThan(0);
    expect(other.item).toBeUndefined();
    expect(JSON.stringify(other)).not.toContain(mine.item!.title);

    const item = (s.party as D.DescriberState).item!;
    const res = D.chat(s, descr, `it is ${item.names[0]} obviously`, 3) as { masked: boolean; penalty: number };
    expect(res.masked).toBe(true);
    expect(s.chat.at(-2)!.text).not.toContain(item.names[0]);

    const guessers = s.players.filter((p) => p.id !== descr).map((p) => p.id);
    expect(D.guess(s, guessers[0], item.names[0], 5000).correct).toBe(true);
    expect(D.guess(s, guessers[1], "totally wrong", 6000).correct).toBe(false);
    const ev = D.tickDescriber(s, s.phaseEndsAt);
    expect(ev.scored!.length).toBe(2);
    expect(s.players.find((p) => p.id === guessers[0])!.score).toBeGreaterThan(0);
    // describer gets 40% of the guess minus the penalty
    expect(ev.scored!.find((r) => r.role === "describer")!.points).toBe(Math.round(ev.scored![0].points * 0.4) - res.penalty);
  });
  it("skips once, rotates and finishes", () => {
    const s = room("describer");
    D.startDescriber(s, "a", 0);
    D.tickDescriber(s, 1);
    D.giveItems(s, D.pickItems(lib, 2, opts()), 1);
    const descr = D.describerId(s)!;
    expect(D.skipItem(s, descr)).toBe(true);
    expect(D.skipItem(s, descr)).toBe(false);
    let t = 10;
    for (let i = 0; i < 40 && s.phase !== "finished"; i++) {
      const ev = D.tickDescriber(s, (t += 100_000));
      if (ev.needItems) D.giveItems(s, D.pickItems(lib, 2, opts()), t);
    }
    expect(s.phase).toBe("ending"); // the host decides: «زد» / new round / «خلاص»
    expect((s.party as D.DescriberState).turn).toBe(3);
  });
});

describe("drawer", () => {
  it("private items, guesses for work + character, own drawing not guessable, votes", () => {
    const s = room("drawer");
    const items = R.pickDrawItems(lib, 6, opts());
    R.startDrawer(s, "a", items, 0);
    const tok = (r: { users?: string[] }) => `tok-${(r.users ?? []).join(",")}`;
    const va = R.drawerView(s, "a", tok, (x) => x)!;
    expect(va.myOffers!.length).toBe(2);
    expect(va.myOffers![0].image).toBe("tok-a");
    for (const p of ["a", "b", "c"]) {
      R.choose(s, p, 0);
      R.submit(s, p, `d-${p}`, 10);
    }
    R.tickDrawer(s, s.phaseEndsAt);
    expect(s.phase).toBe("draw_guess");
    const d = s.party as R.DrawerState;
    const cur = d.drawings.find((x) => x.id === d.order[0])!;
    expect(R.guess(s, cur.playerId, cur.item.workNames[0], 20).own).toBe(true);
    const other = ["a", "b", "c"].find((x) => x !== cur.playerId)!;
    const r1 = R.guess(s, other, cur.item.workNames[0], 20);
    expect(r1.correct).toBe(true);
    if (cur.item.kind === "character") expect(R.guess(s, other, cur.item.names[0], 30).points).toBeGreaterThan(r1.points);
    let t = 100;
    while (s.phase === "draw_guess") R.tickDrawer(s, (t = s.phaseEndsAt));
    expect(s.phase).toBe("draw_vote");
    R.vote(s, "a", "d-b", "best");
    R.vote(s, "a", "d-a", "funny"); // own: ignored
    R.tickDrawer(s, s.phaseEndsAt);
    expect(s.phase).toBe("ending");
    expect(d.drawings.find((x) => x.id === "d-b")!.votesBest).toBe(1);
    expect(d.drawings.find((x) => x.id === "d-a")!.votesFunny).toBe(0);
    expect(R.drawerView(s, "b", tok, (x) => x)!.gallery!.length).toBe(3);
  });
});
