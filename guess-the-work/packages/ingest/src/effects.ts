import sharp from "sharp";
import type { ImageEffectId } from "@gtw/core/effects";
import { seeded, shuffle } from "@gtw/core/rng";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RenderOptions {
  effect: ImageEffectId;
  /** 0 = hardest .. steps-1 = easiest */
  step: number;
  steps: number;
  seed: number;
  /** text areas to hide first (from OCR), in original pixels */
  textBoxes?: Box[];
  maxWidth?: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

async function base(input: Buffer, maxWidth: number) {
  const img = sharp(input).rotate().resize({ width: maxWidth, withoutEnlargement: true }).removeAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, c: info.channels };
}

function fromRaw(data: Buffer | Uint8ClampedArray, w: number, h: number, c = 3) {
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width: w, height: h, channels: c as 3 } });
}

/** Blurs the text boxes (titles, credits) so the name can't be read. */
export async function maskText(input: Buffer, boxes: Box[]): Promise<Buffer> {
  if (!boxes.length) return input;
  const meta = await sharp(input).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const layers = await Promise.all(
    boxes.map(async (b) => {
      const x = Math.max(0, Math.floor(b.x - 6));
      const y = Math.max(0, Math.floor(b.y - 6));
      const w = Math.min(W - x, Math.ceil(b.w + 12));
      const h = Math.min(H - y, Math.ceil(b.h + 12));
      if (w <= 2 || h <= 2) return null;
      const patch = await sharp(input).extract({ left: x, top: y, width: w, height: h }).blur(Math.max(8, h / 2)).toBuffer();
      return { input: patch, left: x, top: y };
    }),
  );
  return sharp(input).composite(layers.filter((l): l is NonNullable<typeof l> => !!l)).toBuffer();
}

/** Renders one reveal step of an effect. Output: JPEG (PNG for ASCII). */
export async function renderEffect(input: Buffer, o: RenderOptions): Promise<{ buffer: Buffer; type: string }> {
  const src = o.textBoxes?.length ? await maskText(input, o.textBoxes) : input;
  const maxW = o.maxWidth ?? 520;
  const t = o.steps <= 1 ? 1 : Math.min(1, Math.max(0, o.step / (o.steps - 1)));
  const rng = seeded(o.seed);
  const jpeg = async (s: sharp.Sharp) => ({ buffer: await s.jpeg({ quality: 82 }).toBuffer(), type: "image/jpeg" });
  const b = await base(src, maxW);
  const img = () => fromRaw(b.data, b.w, b.h, b.c);
  const last = o.step >= o.steps - 1;

  switch (o.effect) {
    case "none":
      return jpeg(img());
    case "blur":
      return jpeg(last ? img() : img().blur(lerp(38, 2.5, t)));
    case "pixelate": {
      const block = Math.max(1, Math.round(lerp(Math.max(b.w, b.h) / 8, 3, t)));
      if (last) return jpeg(img());
      const small = await img().resize(Math.max(2, Math.round(b.w / block)), Math.max(2, Math.round(b.h / block)), { kernel: "nearest" }).png().toBuffer();
      return jpeg(sharp(small).resize(b.w, b.h, { kernel: "nearest" }));
    }
    case "blobs":
      return jpeg(img().blur(lerp(60, 12, t)).modulate({ saturation: 1.4 }));
    case "palette": {
      if (o.step === 0) {
        // stripes of the dominant colours, ordered by how much of the image they cover
        const colours = await dominantColours(b, 7);
        const stripeW = Math.ceil(b.w / colours.length);
        const out = Buffer.alloc(b.w * b.h * 3);
        for (let y = 0; y < b.h; y++)
          for (let x = 0; x < b.w; x++) {
            const col = colours[Math.min(colours.length - 1, Math.floor(x / stripeW))];
            out.set(col, (y * b.w + x) * 3);
          }
        return jpeg(fromRaw(out, b.w, b.h));
      }
      return jpeg(img().blur(o.step === 1 ? 45 : 18).modulate({ saturation: 1.3 }));
    }
    case "invert":
      return jpeg(last ? img() : o.step === 0 ? img().negate() : img().negate().blur(3));
    case "hue": {
      const angle = Math.round(90 + rng() * 180);
      return jpeg(last ? img() : img().modulate({ hue: Math.round(angle * (1 - t)) , saturation: 1.2 }));
    }
    case "grayscale":
      return jpeg(last ? img() : o.step === 0 ? img().greyscale().normalise().threshold(128) : img().greyscale());
    case "edges": {
      const edges = await img()
        .greyscale()
        .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
        .normalise()
        .negate()
        .toBuffer();
      if (o.step === 0) return jpeg(sharp(edges, { raw: { width: b.w, height: b.h, channels: 1 } }));
      if (last) return jpeg(img());
      const faint = await img().modulate({ brightness: 1.4, saturation: 0.6 }).toBuffer();
      return jpeg(sharp(edges, { raw: { width: b.w, height: b.h, channels: 1 } }).toColourspace("srgb").composite([{ input: faint, raw: { width: b.w, height: b.h, channels: 3 }, blend: "multiply" }]));
    }
    case "puzzle": {
      const n = 4;
      const tw = Math.floor(b.w / n);
      const th = Math.floor(b.h / n);
      const cells = Array.from({ length: n * n }, (_, i) => i);
      const order = shuffle(cells, rng);
      // each step puts more pieces back where they belong
      const fixed = Math.round(lerp(0, n * n, t));
      const fixOrder = shuffle(cells, seeded(o.seed + 1)).slice(0, fixed);
      const placement = [...order];
      for (const cell of fixOrder) {
        const at = placement.indexOf(cell);
        [placement[at], placement[cell]] = [placement[cell], placement[at]];
      }
      const out = Buffer.alloc(tw * n * th * n * 3);
      for (let slot = 0; slot < n * n; slot++) {
        const piece = placement[slot];
        const sx = (piece % n) * tw;
        const sy = Math.floor(piece / n) * th;
        const dx = (slot % n) * tw;
        const dy = Math.floor(slot / n) * th;
        for (let y = 0; y < th; y++) b.data.copy(out, ((dy + y) * tw * n + dx) * 3, ((sy + y) * b.w + sx) * 3, ((sy + y) * b.w + sx + tw) * 3);
      }
      return jpeg(fromRaw(out, tw * n, th * n));
    }
    case "tiles": {
      const n = 6;
      const shown = shuffle(Array.from({ length: n * n }, (_, i) => i), rng).slice(0, Math.max(1, Math.round(lerp(2, n * n, t))));
      if (last) return jpeg(img());
      const out = Buffer.alloc(b.w * b.h * 3, 20);
      const tw = Math.ceil(b.w / n);
      const th = Math.ceil(b.h / n);
      for (const cell of shown) {
        const x0 = (cell % n) * tw;
        const y0 = Math.floor(cell / n) * th;
        for (let y = y0; y < Math.min(b.h, y0 + th); y++) b.data.copy(out, (y * b.w + x0) * 3, (y * b.w + x0) * 3, (y * b.w + Math.min(b.w, x0 + tw)) * 3);
      }
      return jpeg(fromRaw(out, b.w, b.h));
    }
    case "zoom":
    case "crop": {
      if (last) return jpeg(img());
      const frac = lerp(o.effect === "zoom" ? 0.12 : 0.25, 0.9, t);
      const cw = Math.max(8, Math.round(b.w * frac));
      const ch = Math.max(8, Math.round(b.h * frac));
      // the zoom stays on one point (chosen by the seed, away from the borders)
      const cx = Math.round(lerp(0.3, 0.7, rng()) * b.w);
      const cy = Math.round(lerp(0.25, 0.6, rng()) * b.h);
      const left = Math.max(0, Math.min(b.w - cw, cx - Math.round(cw / 2)));
      const top = Math.max(0, Math.min(b.h - ch, cy - Math.round(ch / 2)));
      return jpeg(img().extract({ left, top, width: cw, height: ch }).resize(b.w, b.h, { fit: "fill" }));
    }
    case "spotlight": {
      if (last) return jpeg(img());
      const r = lerp(Math.min(b.w, b.h) * 0.1, Math.min(b.w, b.h) * 0.45, t);
      const spots = [0, 1, 2].map(() => [lerp(0.2, 0.8, rng()) * b.w, lerp(0.15, 0.85, rng()) * b.h]);
      const mask = `<svg width="${b.w}" height="${b.h}"><defs><radialGradient id="g"><stop offset="70%" stop-color="white"/><stop offset="100%" stop-color="white" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="black"/>${spots
        .slice(0, o.step + 1)
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#g)"/>`)
        .join("")}</svg>`;
      const m = await sharp(Buffer.from(mask)).greyscale().raw().toBuffer();
      const out = Buffer.alloc(b.w * b.h * 3);
      for (let i = 0; i < b.w * b.h; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = (b.data[i * 3 + k] * m[i]) / 255;
      return jpeg(fromRaw(out, b.w, b.h));
    }
    case "swirl": {
      if (last) return jpeg(img());
      const strength = lerp(9, 1.2, t);
      return jpeg(fromRaw(swirl(b.data, b.w, b.h, strength), b.w, b.h));
    }
    case "ascii":
      return { buffer: await ascii(b, o.step === 0 ? 46 : o.step === 1 ? 70 : 100, o.step >= 1), type: "image/png" };
    case "silhouette":
      return jpeg(fromRaw(silhouette(b.data, b.w, b.h, t), b.w, b.h));
    case "eyes": {
      // character portraits: the eyes are around 25-40 % of the height
      const wFrac = lerp(0.5, 0.95, t);
      const hFrac = lerp(0.12, 0.45, t);
      const cw = Math.round(b.w * wFrac);
      const ch = Math.round(b.h * hFrac);
      const left = Math.round((b.w - cw) / 2);
      const top = Math.max(0, Math.round(b.h * 0.3 - ch / 2));
      return jpeg(img().extract({ left, top, width: cw, height: Math.min(ch, b.h - top) }).resize({ width: b.w }));
    }
  }
}

async function dominantColours(b: { data: Buffer; w: number; h: number }, k: number): Promise<[number, number, number][]> {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < b.w * b.h; i += 3) {
    const r = b.data[i * 3];
    const g = b.data[i * 3 + 1];
    const bl = b.data[i * 3 + 2];
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (bl >> 5);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += r;
    e.g += g;
    e.b += bl;
    buckets.set(key, e);
  }
  return [...buckets.values()]
    .sort((a, b2) => b2.n - a.n)
    .slice(0, k)
    .map((e) => [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)]);
}

export function swirl(data: Buffer, w: number, h: number, strength: number): Buffer {
  const out = Buffer.alloc(w * h * 3);
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) / 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      let sx = x;
      let sy = y;
      if (d < R) {
        const a = strength * (1 - d / R) ** 2;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        sx = Math.round(cx + dx * cos - dy * sin);
        sy = Math.round(cy + dx * sin + dy * cos);
      }
      sx = Math.max(0, Math.min(w - 1, sx));
      sy = Math.max(0, Math.min(h - 1, sy));
      data.copy(out, (y * w + x) * 3, (sy * w + sx) * 3, (sy * w + sx) * 3 + 3);
    }
  return out;
}

/** Background = the colour along the border; everything else becomes black. t>0 lets the colours come back. */
export function silhouette(data: Buffer, w: number, h: number, t: number): Buffer {
  const border: number[][] = [];
  for (let x = 0; x < w; x += 4) border.push([...data.subarray(x * 3, x * 3 + 3)], [...data.subarray(((h - 1) * w + x) * 3, ((h - 1) * w + x) * 3 + 3)]);
  for (let y = 0; y < h; y += 4) border.push([...data.subarray(y * w * 3, y * w * 3 + 3)], [...data.subarray((y * w + w - 1) * 3, (y * w + w - 1) * 3 + 3)]);
  const bg = [0, 1, 2].map((k) => border.reduce((s, p) => s + p[k], 0) / border.length);
  // flood fill from the border through pixels close to the background colour
  const isBg = new Uint8Array(w * h);
  const close = (i: number) => Math.abs(data[i * 3] - bg[0]) + Math.abs(data[i * 3 + 1] - bg[1]) + Math.abs(data[i * 3 + 2] - bg[2]) < 70;
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (isBg[i] || !close(i)) continue;
    isBg[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * (h - 1)) stack.push(i + w);
  }
  const out = Buffer.alloc(w * h * 3);
  const colour = t >= 1 ? 1 : t * 0.6;
  for (let i = 0; i < w * h; i++)
    for (let k = 0; k < 3; k++) out[i * 3 + k] = isBg[i] ? (t >= 1 ? data[i * 3 + k] : 240) : Math.round(data[i * 3 + k] * colour);
  return out;
}

async function ascii(b: { data: Buffer; w: number; h: number }, cols: number, colour: boolean): Promise<Buffer> {
  const chars = " .:-=+*#%@";
  const cellW = b.w / cols;
  const cellH = cellW * 2;
  const rows = Math.floor(b.h / cellH);
  const fs = 10;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * 6}" height="${rows * fs}"><rect width="100%" height="100%" fill="#0b0b10"/><g font-family="monospace" font-size="${fs}">`;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.floor(c * cellW + cellW / 2);
      const y = Math.floor(r * cellH + cellH / 2);
      const i = (Math.min(b.h - 1, y) * b.w + Math.min(b.w - 1, x)) * 3;
      const lum = (0.299 * b.data[i] + 0.587 * b.data[i + 1] + 0.114 * b.data[i + 2]) / 255;
      const ch = chars[Math.min(chars.length - 1, Math.floor(lum * chars.length))];
      if (ch === " ") continue;
      const fill = colour ? `rgb(${b.data[i]},${b.data[i + 1]},${b.data[i + 2]})` : "#e8e8e8";
      svg += `<text x="${c * 6}" y="${(r + 1) * fs}" fill="${fill}">${ch === "&" ? "&amp;" : ch}</text>`;
    }
  }
  svg += "</g></svg>";
  return sharp(Buffer.from(svg)).png().toBuffer();
}
