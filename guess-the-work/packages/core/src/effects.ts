/** Poster / image effects. Rendered on the server; the original never reaches the browser. */
export type ImageEffectId =
  | "blur"
  | "pixelate"
  | "palette"
  | "blobs"
  | "invert"
  | "hue"
  | "grayscale"
  | "edges"
  | "puzzle"
  | "tiles"
  | "zoom"
  | "spotlight"
  | "swirl"
  | "ascii"
  | "silhouette"
  | "eyes"
  | "crop"
  | "none";

export interface EffectInfo {
  id: ImageEffectId;
  ar: string;
  en: string;
  /** 1 easy .. 3 hard */
  difficulty: 1 | 2 | 3;
  /** how many reveal steps (step 0 = hardest, last = easiest) */
  steps: number;
  /** usable on posters (the poster mode picks from these) */
  poster: boolean;
}

export const EFFECTS: Record<ImageEffectId, EffectInfo> = {
  blur: { id: "blur", ar: "غبش يخف", en: "Blur", difficulty: 1, steps: 6, poster: true },
  pixelate: { id: "pixelate", ar: "تبكسل", en: "Pixelate", difficulty: 1, steps: 6, poster: true },
  palette: { id: "palette", ar: "ألوان فقط", en: "Colours only", difficulty: 3, steps: 3, poster: true },
  blobs: { id: "blobs", ar: "بقع ألوان", en: "Colour blobs", difficulty: 3, steps: 4, poster: true },
  invert: { id: "invert", ar: "ألوان معكوسة", en: "Inverted", difficulty: 1, steps: 3, poster: true },
  hue: { id: "hue", ar: "ألوان متغيرة", en: "Hue shift", difficulty: 1, steps: 3, poster: true },
  grayscale: { id: "grayscale", ar: "أبيض وأسود", en: "Black & white", difficulty: 1, steps: 3, poster: true },
  edges: { id: "edges", ar: "خطوط فقط", en: "Lines only", difficulty: 2, steps: 3, poster: true },
  puzzle: { id: "puzzle", ar: "بزل مخلوط", en: "Shuffled puzzle", difficulty: 2, steps: 6, poster: true },
  tiles: { id: "tiles", ar: "مربعات تنكشف", en: "Tiles reveal", difficulty: 2, steps: 8, poster: true },
  zoom: { id: "zoom", ar: "زوم يبعد", en: "Zoom out", difficulty: 2, steps: 6, poster: true },
  spotlight: { id: "spotlight", ar: "كشاف ضوء", en: "Spotlight", difficulty: 3, steps: 6, poster: true },
  swirl: { id: "swirl", ar: "تشويه دوامة", en: "Swirl", difficulty: 2, steps: 5, poster: true },
  ascii: { id: "ascii", ar: "ASCII", en: "ASCII art", difficulty: 3, steps: 3, poster: true },
  silhouette: { id: "silhouette", ar: "ظل", en: "Silhouette", difficulty: 2, steps: 5, poster: false },
  eyes: { id: "eyes", ar: "العيون", en: "Eyes", difficulty: 3, steps: 4, poster: false },
  crop: { id: "crop", ar: "قص", en: "Crop", difficulty: 2, steps: 5, poster: false },
  none: { id: "none", ar: "بدون", en: "None", difficulty: 1, steps: 1, poster: false },
};

export const POSTER_EFFECTS = Object.values(EFFECTS).filter((e) => e.poster).map((e) => e.id);

/** Which step the reveal is at after `elapsedMs` of a question that lasts `limitMs`. */
export function revealStep(elapsedMs: number, limitMs: number, steps: number): number {
  if (steps <= 1) return 0;
  const per = limitMs / steps;
  return Math.max(0, Math.min(steps - 1, Math.floor(elapsedMs / per)));
}
