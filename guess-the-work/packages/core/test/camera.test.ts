import { describe, expect, it } from "vitest";
import { createRoom, join } from "../src/room";
import * as D from "../src/describer";
import { seeded } from "../src/rng";
import { DEFAULT_TIER_MIX } from "../src/types";
import { makeLibrary } from "./fixtures";

const lib = makeLibrary();
const items = () => D.pickItems(lib, 2, { mix: DEFAULT_TIER_MIX, rng: seeded(3) });

function room(style: "mime" | "talk" = "talk") {
  const s = createRoom("CAM", { id: "a", name: "A" }, { kind: "camera", count: 1, camera: { setupSec: 30, style } }, 0);
  join(s, { id: "b", name: "B" }, 0);
  join(s, { id: "c", name: "C" }, 0);
  D.startDescriber(s, "a", 0);
  D.tickDescriber(s, 1);
  D.giveItems(s, items(), 1);
  const who = D.describerId(s)!;
  D.choose(s, who, 0, 2);
  return { s, who, others: ["a", "b", "c"].filter((x) => x !== who) };
}

describe("اشرح بالكاميرا", () => {
  it("setup stage after choosing, then 'camera ready' starts the turn at once", () => {
    const { s, who } = room();
    expect(s.phase).toBe("camera_setup");
    expect(s.phaseEndsAt).toBe(2 + 30_000);
    D.cameraReady(s, who, 5000);
    expect(s.phase).toBe("describe_turn");
    expect((s.party as D.DescriberState).turnMode).toBe("camera");
    expect(D.describerView(s, "zz", (r) => String(r.users), (x) => x)!.cameraOn).toBe(true);
  });
  it("no camera -> explain by talking (describer rules)", () => {
    const { s, who } = room();
    D.noCamera(s, who, 1000);
    expect(s.phase).toBe("camera_confirm");
    D.cameraChoice(s, who, "talk", 2000);
    expect(s.phase).toBe("describe_turn");
    expect((s.party as D.DescriberState).turnMode).toBe("talk");
  });
  it("no camera -> skip my turn: next player, no points, no penalty", () => {
    const { s, who } = room();
    D.noCamera(s, who, 1000);
    D.cameraChoice(s, who, "skip", 1500);
    expect(s.phase).toBe("describe_choose");
    expect(D.describerId(s)).not.toBe(who);
    expect(s.players.every((p) => p.score === 0)).toBe(true);
  });
  it("back from the confirm returns to the setup", () => {
    const { s, who } = room();
    D.noCamera(s, who, 1000);
    D.cameraChoice(s, who, "back", 1200);
    expect(s.phase).toBe("camera_setup");
  });
  it("setup time out -> confirm; no choice in 10 s -> turn skipped", () => {
    const { s, who } = room();
    D.tickDescriber(s, 2 + 30_000);
    expect(s.phase).toBe("camera_confirm");
    expect(s.phaseEndsAt).toBe(2 + 30_000 + 10_000);
    D.tickDescriber(s, 2 + 40_000);
    expect(s.phase).toBe("describe_choose");
    expect(D.describerId(s)).not.toBe(who);
  });
  it("guessing and points like the describer; the explainer gets a share", () => {
    const { s, who, others } = room();
    D.cameraReady(s, who, 3000);
    const item = (s.party as D.DescriberState).item!;
    expect(D.guess(s, others[0], item.names[0], 5000).correct).toBe(true);
    const ev = D.tickDescriber(s, s.phaseEndsAt);
    const g = ev.scored!.find((r) => r.userId === others[0])!;
    expect(g.points).toBeGreaterThan(0);
    expect(ev.scored!.find((r) => r.userId === who)!.points).toBe(Math.round(g.points * 0.4));
  });
  it("talking style: a reported violation costs points only after the host approves", () => {
    const { s, who, others } = room("talk");
    D.cameraReady(s, who, 3000);
    const id = D.reportViolation(s, others[0], 4000)!;
    expect(D.reportViolation(s, who, 4000)).toBeNull(); // not on yourself
    expect((s.party as D.DescriberState).penalty).toBe(0);
    expect(() => D.approveReport(s, others[1] === s.hostId ? others[0] : others[1], id)).toThrow();
    D.approveReport(s, s.hostId === who ? who : s.hostId, id);
    expect((s.party as D.DescriberState).penalty).toBe(s.settings.describe.penalty);
  });
  it("mime style: no word reports", () => {
    const { s, who, others } = room("mime");
    D.cameraReady(s, who, 3000);
    expect(D.reportViolation(s, others[0], 4000)).toBeNull();
  });
});
