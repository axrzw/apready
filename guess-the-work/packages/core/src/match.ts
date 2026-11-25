/**
 * One matching function for everything: answers, forbidden words (describer),
 * hiding names in plots, and checking that a hint never leaks an accepted name.
 */

const AR_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;
const LATIN_MARKS = /[̀-ͯ]/g;
const CJK = /[぀-ヿ㐀-鿿가-힯]/;

const AR_ORDINALS: Record<string, number> = {
  الاول: 1, الثاني: 2, الثالث: 3, الرابع: 4, الخامس: 5, السادس: 6, السابع: 7, الثامن: 8,
};
const ROMAN: Record<string, number> = { ii: 2, iii: 3, iv: 4 };

function arabicDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Letters only, unified Arabic letters, lower-case Latin, unified seasons. */
export function normalize(input: string): string {
  let s = (input ?? "").normalize("NFKC");
  s = s.normalize("NFD").replace(LATIN_MARKS, "").normalize("NFC");
  s = arabicDigits(s)
    .replace(AR_DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  // seasons
  s = s
    .replace(/\bseason (\d+)\b/g, "s$1")
    .replace(/\b(\d+)(?:st|nd|rd|th) season\b/g, "s$1")
    .replace(/\b(?:part|cour) (\d+)\b/g, "s$1")
    .replace(/(^|\s)(?:الموسم|الجزء) (\d+)(?=\s|$)/g, "$1s$2")
    .replace(/(^|\s)(?:الموسم|الجزء) (ال\S+)(?=\s|$)/g, (m, sp: string, w: string) =>
      AR_ORDINALS[w] ? `${sp}s${AR_ORDINALS[w]}` : m,
    )
    .replace(/ (ii|iii|iv)$/g, (_m, r: string) => ` s${ROMAN[r]}`);
  return s.replace(/\s+/g, " ").trim();
}

function stripSeason(n: string): string {
  return n.replace(/(^|\s)s\d+(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();
}

/** Optimal string alignment distance (Levenshtein + adjacent transpositions). */
export function editDistance(a: string, b: string): number {
  const A = [...a];
  const B = [...b];
  const m = A.length;
  const n = B.length;
  if (!m) return n;
  if (!n) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array<number>(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = A[i - 1] === B[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && A[i - 1] === B[j - 2] && A[i - 2] === B[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
    }
  }
  return d[m][n];
}

/** Allowed typos for a name of this (normalized, no spaces) length. Short names: exact only. */
export function maxDistance(len: number): number {
  if (len <= 6) return 0;
  if (len <= 10) return 1;
  if (len <= 16) return 2;
  if (len <= 24) return 3;
  return 4;
}

function close(a: string, b: string): number | null {
  if (!a || !b) return null;
  if (a === b) return 0;
  const ca = a.replace(/ /g, "");
  const cb = b.replace(/ /g, "");
  if (ca === cb) return 0;
  const allowed = maxDistance([...cb].length);
  if (!allowed || ca[0] !== cb[0]) return null;
  if (Math.abs([...ca].length - [...cb].length) > allowed) return null;
  const d = editDistance(ca, cb);
  return d <= allowed ? d : null;
}

export interface MatchResult {
  ok: boolean;
  alias?: string;
  distance?: number;
}

export function matchAnswer(input: string, names: readonly string[]): MatchResult {
  const n = normalize(input);
  if (!n) return { ok: false };
  const inputs = Array.from(new Set([n, stripSeason(n)].filter(Boolean)));
  let best: MatchResult = { ok: false };
  for (const alias of names) {
    const na = normalize(alias);
    if (!na) continue;
    for (const a of new Set([na, stripSeason(na)].filter(Boolean))) {
      for (const i of inputs) {
        const d = close(i, a);
        if (d !== null && (!best.ok || d < (best.distance ?? 99))) best = { ok: true, alias, distance: d };
      }
    }
    if (best.ok && best.distance === 0) return best;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Names inside free text

const STOP = new Set(
  "the and with from that this your their about after before into over under world story love life house girl boy city great good best time other there where what when which while kimi wa ga no ni wo de to".split(
    " ",
  ),
);

export interface NameSpan {
  start: number;
  end: number;
  name: string;
}

interface Tok {
  start: number;
  end: number;
  norm: string[]; // variants (with/without Arabic prefixes)
}

const AR_PREFIX = /^(?:و|ف|ب|ل|ك)?(?:ال)?/;

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
    const raw = m[0];
    const n = normalize(raw);
    if (!n) continue;
    const variants = new Set([n]);
    if (/[؀-ۿ]/.test(n)) {
      const stripped = n.replace(AR_PREFIX, "");
      if (stripped.length >= 3) variants.add(stripped);
      if (/^[وفبلك]/.test(n) && n.length > 4) variants.add(n.slice(1));
    }
    out.push({ start: m.index!, end: m.index! + raw.length, norm: [...variants] });
  }
  return out;
}

function needlesFor(names: readonly string[], tokens: boolean): string[][] {
  const set = new Map<string, string[]>();
  for (const name of names) {
    const n = normalize(name);
    if (!n) continue;
    set.set(n, n.split(" "));
    if (tokens) {
      for (const t of n.split(" ")) {
        const bare = t.replace(AR_PREFIX, "");
        if ([...t].length >= 4 && !STOP.has(t) && !/^s\d+$/.test(t)) set.set(t, [t]);
        if (bare !== t && [...bare].length >= 4) set.set(bare, [bare]);
      }
    }
  }
  // longest first so a full title wins over its words
  return [...set.values()].sort((a, b) => b.join(" ").length - a.join(" ").length);
}

export interface FindOptions {
  /** also match single words of multi-word names (first names, title words). Default true. */
  tokens?: boolean;
}

export function findNames(text: string, names: readonly string[], opts: FindOptions = {}): NameSpan[] {
  const tokens = opts.tokens ?? true;
  const toks = tokenize(text);
  const used = new Array<boolean>(toks.length).fill(false);
  const spans: NameSpan[] = [];
  for (const needle of needlesFor(names, tokens)) {
    const k = needle.length;
    const target = needle.join(" ");
    for (let i = 0; i + k <= toks.length; i++) {
      if (used.slice(i, i + k).some(Boolean)) continue;
      const firsts = toks[i].norm;
      const rest = toks.slice(i + 1, i + k).map((t) => t.norm[0]);
      const hit = firsts.some((f) => close([f, ...rest].join(" "), target) !== null);
      if (hit) {
        for (let j = i; j < i + k; j++) used[j] = true;
        spans.push({ start: toks[i].start, end: toks[i + k - 1].end, name: target });
      }
    }
  }
  // names written in Japanese/Chinese are not space separated: plain substring search
  for (const name of names) {
    if (!CJK.test(name)) continue;
    let at = text.indexOf(name);
    while (at >= 0) {
      if (!spans.some((s) => at < s.end && at + name.length > s.start)) spans.push({ start: at, end: at + name.length, name });
      at = text.indexOf(name, at + name.length);
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

export function redactNames(text: string, names: readonly string[], mask = "▇▇▇", opts?: FindOptions): string {
  let out = text;
  for (const s of findNames(text, names, opts).reverse()) out = out.slice(0, s.start) + mask + out.slice(s.end);
  return out;
}

export function leaksAnswer(text: string, names: readonly string[]): boolean {
  return findNames(text, names).length > 0;
}
