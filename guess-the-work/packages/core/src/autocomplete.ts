import { editDistance, normalize } from "./match";

/**
 * Autocomplete over the whole library (SPEC 10). The browser downloads the index once and searches locally.
 * The ranking depends only on the typed text and general popularity: never on the current question.
 * Arabic <-> Latin works through a consonant "skeleton": ناروتو and Naruto both become "nrt".
 */
export interface IndexItem {
  id: string;
  label: string;
  labelAr?: string;
  names: string[];
  pop: number;
}

interface Name {
  raw: string;
  norm: string;
  compact: string;
  tokens: string[];
  starts: number[]; // start of each token inside norm
  acronym: string;
  /** skeleton from each word to the end (precomputed: the search runs per keystroke) */
  skelFrom: string[];
}

interface Entry {
  item: IndexItem;
  names: Name[];
}

export interface Index {
  entries: Entry[];
}

export interface Suggestion {
  id: string;
  label: string;
  labelAr?: string;
  /** the name that matched the typed text */
  matched: string;
  /** [start, end) of the matched part inside `matched` (best effort) */
  hl: [number, number];
  score: number;
}

const AR: Record<string, string> = {
  ب: "b", پ: "b", ت: "t", ط: "t", ث: "s", ج: "g", چ: "S", ح: "h", خ: "k", د: "d", ض: "d", ذ: "z", ز: "z", ظ: "z", ر: "r", س: "s", ص: "s", ش: "S",
  غ: "g", ف: "f", ڤ: "f", ق: "k", ك: "k", گ: "g", ل: "l", م: "m", ن: "n", ه: "h",
};

function latinSkel(w: string): string {
  let s = w
    .replace(/tch/g, "tS")
    .replace(/ch/g, "tS")
    .replace(/sh/g, "S")
    .replace(/th/g, "t")
    .replace(/ph/g, "f")
    .replace(/kh/g, "k")
    .replace(/gh/g, "g")
    .replace(/ck/g, "k")
    .replace(/qu/g, "k")
    .replace(/x/g, "ks")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/q/g, "k")
    .replace(/v/g, "f")
    .replace(/p/g, "b")
    .replace(/j/g, "g");
  s = s.replace(/[aeiouwy]/g, "").replace(/h$/, "");
  return s.replace(/(.)\1+/g, "$1");
}

function arabicSkel(w: string): string {
  const t = w.length > 3 ? w.replace(/^ال/, "") : w;
  let s = "";
  for (const ch of t) s += AR[ch] ?? "";
  return s.replace(/h$/, "").replace(/(.)\1+/g, "$1");
}

/** Consonant skeleton of a name, words joined (for display tests) */
export function skeleton(text: string): string {
  return normalize(text)
    .split(" ")
    .map((w) => (/[؀-ۿ]/.test(w) ? arabicSkel(w) : latinSkel(w)))
    .filter(Boolean)
    .join("");
}

/** Fast bounded check: is the edit distance at most k? (banded, no full matrix) */
function within(a: string, b: string, k: number): boolean {
  if (Math.abs(a.length - b.length) > k) return false;
  let prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(k + 1);
    cur[0] = i;
    let rowMin = cur[0];
    const lo = Math.max(1, i - k);
    const hi = Math.min(b.length, i + k);
    for (let j = lo; j <= hi; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > k) return false;
    prev = cur;
  }
  return prev[b.length] <= k;
}

const SMALL = new Set(["the", "a", "an", "of", "no", "wa", "ga", "to", "x", "and"]);

function prep(raw: string): Name {
  const norm = normalize(raw);
  const tokens = norm.split(" ").filter(Boolean);
  const starts: number[] = [];
  let at = 0;
  for (const t of tokens) {
    starts.push(norm.indexOf(t, at));
    at = starts.at(-1)! + t.length;
  }
  const latinTokens = tokens.filter((t) => /^[a-z0-9]+$/.test(t));
  const acronym = latinTokens.length >= 2 ? latinTokens.map((t) => t[0]).join("") : "";
  const words = tokens.map((w) => (/[\u0600-\u06ff]/.test(w) ? arabicSkel(w) : latinSkel(w)));
  const skelFrom = words.map((_, k) => words.slice(k).join(""));
  return { raw, norm, compact: norm.replace(/ /g, ""), tokens, starts, acronym, skelFrom };
}

export function buildIndex(items: IndexItem[]): Index {
  return {
    entries: items.map((item) => ({ item, names: [...new Set([item.label, item.labelAr, ...item.names].filter((x): x is string => !!x))].map(prep) })),
  };
}

/** Maps a position in the normalized string back to the raw string (good enough for highlighting). */
function rawRange(n: Name, start: number, len: number): [number, number] {
  const ratio = n.raw.length / Math.max(1, n.norm.length);
  const s = Math.max(0, Math.round(start * ratio));
  return [s, Math.min(n.raw.length, s + Math.max(1, Math.round(len * ratio)))];
}

function scoreName(n: Name, q: string, qTokens: string[], qSkel: string): { score: number; hl: [number, number] } | null {
  if (n.norm === q) return { score: 1000, hl: [0, n.raw.length] };
  if (n.norm.startsWith(q) || n.compact.startsWith(q.replace(/ /g, ""))) return { score: 900 - Math.min(99, n.norm.length - q.length), hl: rawRange(n, 0, q.length) };
  // from the start of any word (several typed words in order)
  for (let i = 1; i < n.tokens.length; i++) {
    if (n.norm.slice(n.starts[i]).startsWith(q)) return { score: 820 - i, hl: rawRange(n, n.starts[i], q.length) };
  }
  if (n.acronym && q.length >= 2 && q.length <= 6 && n.acronym === q.replace(/ /g, "")) return { score: 780, hl: [0, n.raw.length] };
  const inside = n.norm.indexOf(q);
  if (inside > 0 && q.length >= 3) return { score: 650, hl: rawRange(n, inside, q.length) };
  // Arabic letters for a Latin name (and back): same consonants from the start of a word
  if (qSkel.length >= 2) {
    for (let i = 0; i < n.skelFrom.length; i++) {
      const rest = n.skelFrom[i];
      if (rest[0] !== qSkel[0]) continue;
      if (rest.startsWith(qSkel)) return { score: 560 - i * 5 - Math.min(40, rest.length - qSkel.length), hl: rawRange(n, n.starts[i] ?? 0, n.tokens[i]?.length ?? 1) };
      if (qSkel.length >= 4 && within(rest.slice(0, qSkel.length), qSkel, 1)) return { score: 470 - i * 5, hl: rawRange(n, n.starts[i] ?? 0, n.tokens[i]?.length ?? 1) };
    }
  }
  // typos: a word that is close to the typed word(s)
  const lastQ = qTokens.at(-1)!;
  if (lastQ.length >= 4) {
    const allowed = lastQ.length >= 7 ? 2 : 1;
    for (let i = 0; i < n.tokens.length; i++) {
      const t = n.tokens[i];
      if (t[0] !== lastQ[0] || SMALL.has(t) || t.length + allowed < lastQ.length) continue;
      const cut = t.slice(0, lastQ.length);
      const d = within(cut, lastQ, allowed) ? editDistance(cut, lastQ) : within(t, lastQ, allowed) ? editDistance(t, lastQ) : 99;
      if (d <= allowed) return { score: 420 - d * 30 - i, hl: rawRange(n, n.starts[i], t.length) };
    }
  }
  return null;
}

export function searchIndex(idx: Index, text: string, limit = 8): Suggestion[] {
  const q = normalize(text);
  if ([...q.replace(/ /g, "")].length < 2) return [];
  const qTokens = q.split(" ").filter(Boolean);
  const qSkel = qTokens.map((w) => (/[؀-ۿ]/.test(w) ? arabicSkel(w) : latinSkel(w))).join("");
  const out: Suggestion[] = [];
  for (const e of idx.entries) {
    let best: { score: number; hl: [number, number]; name: Name } | null = null;
    for (const n of e.names) {
      const r = scoreName(n, q, qTokens, qSkel);
      if (r && (!best || r.score > best.score)) best = { ...r, name: n };
    }
    if (best) out.push({ id: e.item.id, label: e.item.label, labelAr: e.item.labelAr, matched: best.name.raw, hl: best.hl, score: best.score + Math.min(60, Math.log10(1 + e.item.pop) * 10) });
  }
  // score, then popularity, then id: the same text always gives the same list
  out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out.slice(0, limit);
}
