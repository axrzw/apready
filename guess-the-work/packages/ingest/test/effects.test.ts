import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderEffect, maskText } from "../src/effects";
import { EFFECTS, type ImageEffectId } from "@gtw/core/effects";

async function testImage() {
  // a "poster": gradient + a white character in the middle on a flat background
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420"><rect width="300" height="420" fill="#3060c0"/><circle cx="150" cy="180" r="70" fill="#f0c060"/><rect x="100" y="240" width="100" height="140" fill="#c03030"/><text x="20" y="40" font-size="30" fill="white">TITLE</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg().toBuffer();
}

describe("image effects", async () => {
  const img = await testImage();
  const ids = Object.keys(EFFECTS) as ImageEffectId[];
  for (const id of ids) {
    it(`${id} renders every step`, async () => {
      const steps = EFFECTS[id].steps;
      const outs: Buffer[] = [];
      for (let s = 0; s < steps; s++) {
        const r = await renderEffect(img, { effect: id, step: s, steps, seed: 42 });
        const meta = await sharp(r.buffer).metadata();
        expect(meta.width).toBeGreaterThan(10);
        outs.push(r.buffer);
      }
      if (id !== "none" && steps > 1) expect(outs[0].equals(outs[steps - 1])).toBe(false);
    });
  }
  it("is deterministic for a seed", async () => {
    const a = await renderEffect(img, { effect: "puzzle", step: 1, steps: 6, seed: 5 });
    const b = await renderEffect(img, { effect: "puzzle", step: 1, steps: 6, seed: 5 });
    expect(a.buffer.equals(b.buffer)).toBe(true);
  });
  it("masks text boxes", async () => {
    const out = await maskText(img, [{ x: 15, y: 10, w: 110, h: 40 }]);
    expect(out.equals(img)).toBe(false);
  });
  it("silhouette makes the character black and the background light", async () => {
    const r = await renderEffect(img, { effect: "silhouette", step: 0, steps: 5, seed: 1 });
    const { data, info } = await sharp(r.buffer).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => data[(y * info.width + x) * info.channels];
    expect(px(150, 180)).toBeLessThan(40);
    expect(px(10, 400)).toBeGreaterThan(200);
  });
});

describe("silhouette fallback", () => {
  it("uses a stencil when the fill eats almost everything (white character on white)", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#fafafa"/><rect x="60" y="60" width="80" height="180" fill="#f0f0f0"/><circle cx="100" cy="100" r="20" fill="#202020"/></svg>`;
    const img = await sharp(Buffer.from(svg)).jpeg().toBuffer();
    const r = await renderEffect(img, { effect: "silhouette", step: 0, steps: 5, seed: 1 });
    const { data, info } = await sharp(r.buffer).raw().toBuffer({ resolveWithObject: true });
    expect(data[(100 * info.width + 100) * info.channels]).toBeLessThan(60);
  });
});
