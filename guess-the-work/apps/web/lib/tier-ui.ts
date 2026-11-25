import type { TierRow } from "@gtw/core/tierlist";

/** Muted, graded tier colours (warm at the top, cool at the bottom): docs/DESIGN.md. */
export const TIER_COLOR: Record<TierRow, string> = { S: "#C9A45C", A: "#B98A5E", B: "#9C8F63", C: "#6F8A72", D: "#5E7A8C", F: "#6D6580" };

export interface TierItemView {
  id: string;
  kind: "work" | "character" | "theme";
  title: string;
  titleAr?: string;
  sub?: string;
  image?: string;
  audio?: string;
}

export const label = (x: { title: string; titleAr?: string }) => x.titleAr || x.title;

/** Draws a board as a PNG (in the browser, so Arabic is shaped by the page fonts). Images come from /api/m (same origin). */
export async function exportBoard(title: string, items: TierItemView[], board: Record<string, TierRow>): Promise<string> {
  await document.fonts.ready;
  const rows = ["S", "A", "B", "C", "D", "F"] as TierRow[];
  const W = 1200;
  const cell = 96;
  const ch = 144;
  const per = Math.floor((W - 160 - 40) / (cell + 8));
  const heights = rows.map((r) => Math.max(1, Math.ceil(items.filter((it) => board[it.id] === r).length / per)) * (ch + 8) + 8);
  const H = 160 + heights.reduce((a, b) => a + b, 0) + 70;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  const css = getComputedStyle(document.documentElement);
  const display = css.getPropertyValue("--font-display").trim() || "serif";
  const body = css.getPropertyValue("--font-body").trim() || "sans-serif";
  ctx.fillStyle = "#0b0b0d";
  ctx.fillRect(0, 0, W, H);
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.fillStyle = "#eeeae2";
  ctx.font = `64px ${display}`;
  ctx.fillText(title, W - 40, 100);
  const imgs = new Map<string, HTMLImageElement>();
  await Promise.all(
    items.map(
      (it) =>
        new Promise<void>((res) => {
          if (!it.image) return res();
          const im = new Image();
          im.onload = () => (imgs.set(it.id, im), res());
          im.onerror = () => res();
          im.src = it.image;
        }),
    ),
  );
  let y = 150;
  rows.forEach((r, ri) => {
    const h = heights[ri];
    ctx.fillStyle = TIER_COLOR[r];
    ctx.fillRect(W - 40 - 110, y, 110, h - 8);
    ctx.fillStyle = "#16161a";
    ctx.fillRect(40, y, W - 80 - 118, h - 8);
    ctx.fillStyle = "#0b0b0d";
    ctx.textAlign = "center";
    ctx.font = `72px ${display}`;
    ctx.fillText(r, W - 40 - 55, y + (h - 8) / 2 + 26);
    const mine = items.filter((it) => board[it.id] === r);
    mine.forEach((it, i) => {
      const x = W - 40 - 118 - 8 - (i % per) * (cell + 8) - cell;
      const yy = y + 8 + Math.floor(i / per) * (ch + 8);
      const im = imgs.get(it.id);
      if (im) {
        const s = Math.max(cell / im.width, ch / im.height);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, yy, cell, ch);
        ctx.clip();
        ctx.drawImage(im, x + (cell - im.width * s) / 2, yy + (ch - im.height * s) / 2, im.width * s, im.height * s);
        ctx.restore();
      } else {
        ctx.fillStyle = "#1e1e23";
        ctx.fillRect(x, yy, cell, ch);
        ctx.fillStyle = "#eeeae2";
        ctx.font = `16px ${body}`;
        ctx.fillText(label(it).slice(0, 14), x + cell / 2, yy + ch / 2);
      }
    });
    y += h;
  });
  ctx.textAlign = "right";
  ctx.fillStyle = "#5f5b55";
  ctx.font = `24px ${body}`;
  ctx.fillText("خمّن العمل · تير ليست", W - 40, H - 30);
  return c.toDataURL("image/png");
}
