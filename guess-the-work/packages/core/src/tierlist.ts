import type { RoomState } from "./room";
import { OPEN_BATCH, finishGame, reachEnd, systemMsg } from "./room";
import type { LibraryIndex } from "./library";
import type { Work } from "./types";
import type { TierStyle, TierTopic, TierTopicType, TierSettings } from "./tier-settings";
import type { WatchMap } from "./group";
import { seenBy } from "./group";
import { shuffle, type Rng } from "./rng";

/**
 * «تير ليست» (party mode, not in Mix): rank items S..F together (secret vote / free discussion),
 * each on their own board («فردي»), or guess a friend's board («خمّن تير صاحبك»).
 */
export const TIER_ROWS = ["S", "A", "B", "C", "D", "F"] as const;
export type TierRow = (typeof TIER_ROWS)[number];
export type Placement = TierRow | "unseen";
export const TIER_VALUE: Record<TierRow, number> = { S: 6, A: 5, B: 4, C: 3, D: 2, F: 1 };
/** a tier as a 10-point rating (the watch log / taste similarity) */
export const TIER_RATING: Record<TierRow, number> = { S: 10, A: 8.5, B: 7, C: 5.5, D: 4, F: 2 };

export { TIER_STYLES, TIER_TOPICS, DEFAULT_TIER_SETTINGS } from "./tier-settings";
export type { TierStyle, TierTopicType, TierTopic, TierSettings } from "./tier-settings";

export interface TierItem {
  id: string;
  workId?: string;
  kind: "work" | "character" | "theme";
  title: string;
  titleAr?: string;
  sub?: string;
  image?: string;
  /** openings / endings / OSTs: played on each device */
  audio?: string;
}

export interface ItemResult {
  tier: TierRow | null;
  how: "majority" | "average" | "host" | "placed" | "skipped";
  /** players whose opinion was not the final tier */
  disagree: number;
  /** everybody's opinion (shown after locking) */
  opinions: Record<string, TierRow>;
}

export interface TierState {
  style: TierStyle;
  items: TierItem[];
  /** collective: the item on the table */
  index: number;
  /** the group's board (collective: locked tiers; individual: the average; guess: the target's) */
  board: Record<string, TierRow>;
  results: Record<string, ItemResult>;
  /** vote: secret votes for the current item */
  votes: Record<string, TierRow>;
  /** discuss: where the item sits now, who moved it, who agreed */
  placement?: { tier: TierRow; by: string; at: number };
  agrees: string[];
  opinions: Record<string, TierRow>;
  /** individual boards */
  boards: Record<string, Record<string, Placement>>;
  submitted: string[];
  /** items from this index on are on the current board (after «زد») */
  from: number;
  target?: string;
  /** points from this tier list (also added to the scores) */
  points: Record<string, number>;
}

export const RESULT_SEC = 4;
export const TIEBREAK_SEC = 15;
export const REVEAL_SEC = 90;

const st = (s: RoomState) => s.party as TierState;
const collective = (style: TierStyle) => style === "vote" || style === "discuss";
const playing = (s: RoomState) => s.players.filter((p) => !p.spectator);

function setPhase(s: RoomState, phase: RoomState["phase"], now: number, sec: number) {
  s.phase = phase;
  s.phaseStartedAt = now;
  s.phaseEndsAt = now + sec * 1000;
}

// ---------------------------------------------------------------------------
// Pure rules

export function valueTier(v: number): TierRow {
  const n = Math.min(6, Math.max(1, Math.round(v)));
  return TIER_ROWS[6 - n];
}

/** Average of tiers, rounded to the nearest tier (half rounds up). */
export function averageTier(ts: TierRow[]): TierRow | null {
  if (!ts.length) return null;
  return valueTier(ts.reduce((a, t) => a + TIER_VALUE[t], 0) / ts.length);
}

/** Same tier 100, one off 50, two off 20, else 0. */
export function proximityPoints(a: TierRow, b: TierRow): number {
  const d = Math.abs(TIER_VALUE[a] - TIER_VALUE[b]);
  return d === 0 ? 100 : d === 1 ? 50 : d === 2 ? 20 : 0;
}

/** Secret vote: a majority wins; else the average; an exact half between two tiers goes to the host. */
export function decideVote(votes: TierRow[]): { tier: TierRow | null; how: "majority" | "average" | "tie" } {
  if (!votes.length) return { tier: null, how: "average" };
  const count = new Map<TierRow, number>();
  for (const v of votes) count.set(v, (count.get(v) ?? 0) + 1);
  const [top, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n > votes.length / 2) return { tier: top, how: "majority" };
  const mean = votes.reduce((a, t) => a + TIER_VALUE[t], 0) / votes.length;
  if (Math.abs(mean - Math.floor(mean) - 0.5) < 1e-9) return { tier: null, how: "tie" };
  return { tier: valueTier(mean), how: "average" };
}

// ---------------------------------------------------------------------------
// Items from the library

function workOk(w: Work, t: TierTopic): boolean {
  if (t.yearFrom && (!w.year || w.year < t.yearFrom)) return false;
  if (t.yearTo && (!w.year || w.year > t.yearTo)) return false;
  if (t.season && (w.season ?? "").toUpperCase() !== t.season.toUpperCase()) return false;
  const has = (list: string[], v?: string) => !v || list.some((x) => x.toLowerCase() === v.toLowerCase());
  if (!has(w.studios, t.studio) || !has(w.genres, t.genre) || !has(w.tags, t.tag)) return false;
  if (t.popTier && w.tier !== t.popTier) return false;
  return true;
}

const CAT: Partial<Record<TierTopicType, string[]>> = { anime: ["anime"], series: ["series"], movie: ["movie"], game: ["game"] };

export interface ItemOptions {
  count: number;
  rng: Rng;
  /** items already on the board */
  exclude?: Set<string>;
  watch?: WatchMap;
  players?: string[];
  source?: TierSettings["source"];
}

function workItem(w: Work): TierItem {
  return { id: `w:${w.id}`, workId: w.id, kind: "work", title: w.title, titleAr: w.titleAr, sub: w.year ? String(w.year) : undefined, image: w.posterUrl };
}

/** One item by id (manual picks, «عيدها»). */
export function itemById(lib: LibraryIndex, id: string): TierItem | null {
  const [k, ...rest] = id.split(":");
  const ref = rest.join(":");
  if (k === "w") {
    const w = lib.work.get(ref);
    return w ? workItem(w) : null;
  }
  if (k === "c") {
    const c = lib.character.get(ref);
    const w = c && lib.work.get(c.workId);
    return c && w ? { id, workId: w.id, kind: "character", title: c.name, titleAr: c.nameAr, sub: w.titleAr ?? w.title, image: c.imageUrl } : null;
  }
  if (k === "t") {
    const t = lib.theme.get(ref);
    const w = t && lib.work.get(t.workId);
    const audio = t && (t.audioClip ?? t.audioUrl ?? t.videoUrl);
    return t && w && audio ? { id, workId: w.id, kind: "theme", title: t.song, sub: `${t.type}${t.seq ?? ""} · ${w.titleAr ?? w.title}`, image: w.posterUrl, audio } : null;
  }
  return null;
}

/** Items for a topic: well-known first (a tier list of things nobody saw is no fun), shuffled. */
export function tierItems(lib: LibraryIndex, topic: TierTopic, o: ItemOptions): TierItem[] {
  const ex = o.exclude ?? new Set<string>();
  const room = o.players ?? [];
  const bySource = (workId: string) => {
    if (!o.watch || !o.source || o.source === "any" || o.source === "manual") return true;
    const seen = seenBy(o.watch.get(workId), room);
    return o.source === "someone" ? seen.length > 0 : seen.length === room.length && room.length > 0;
  };
  const cats = topic.type === "custom" ? (topic.categories?.length ? topic.categories : null) : CAT[topic.type] ?? null;
  const works = lib.works.filter((w) => (!cats || cats.includes(w.category)) && workOk(w, topic) && bySource(w.id));
  let pool: { item: TierItem; pop: number }[];
  if (topic.type === "character") {
    pool = works.flatMap((w) =>
      (lib.charsByWork.get(w.id) ?? [])
        .filter((c) => c.role === "MAIN" && c.imageUrl)
        .map((c) => ({ item: itemById(lib, `c:${c.id}`)!, pop: (c.favourites ?? 0) + w.popularity / 50 })),
    );
  } else if (topic.type === "opening" || topic.type === "ending" || topic.type === "ost") {
    const type = topic.type === "opening" ? "OP" : topic.type === "ending" ? "ED" : "OST";
    pool = works.flatMap((w) =>
      (lib.themesByWork.get(w.id) ?? [])
        .filter((t) => t.type === type)
        .map((t) => ({ item: itemById(lib, `t:${t.id}`), pop: w.popularity / (t.seq ?? 1) }))
        .filter((x): x is { item: TierItem; pop: number } => !!x.item),
    );
  } else {
    pool = works.filter((w) => w.posterUrl).map((w) => ({ item: workItem(w), pop: w.popularity }));
  }
  pool = pool.filter((x) => x.item && !ex.has(x.item.id)).sort((a, b) => b.pop - a.pop);
  const top = pool.slice(0, Math.max(o.count * 4, 40));
  return shuffle(top, o.rng)
    .slice(0, o.count)
    .map((x) => x.item);
}

// ---------------------------------------------------------------------------
// The game

export function startTierlist(s: RoomState, by: string, items: TierItem[], now: number) {
  if (by !== s.hostId) throw new Error("only the host");
  if (!items.length) throw new Error("ما لقيت عناصر لهذا الموضوع. وسّع الفلاتر.");
  const cfg = s.settings.tier;
  const players = playing(s);
  if (cfg.style === "guess_friend" && players.length < 2) throw new Error("«خمّن تير صاحبك» يبي لاعبين على الأقل");
  for (const p of s.players) (p.score = 0), (p.streak = 0);
  const target = cfg.style === "guess_friend" ? (players.some((p) => p.id === cfg.target) ? cfg.target : s.hostId) : undefined;
  s.questions = [];
  s.index = 0;
  s.want = 0;
  s.noMore = false;
  s.stopping = false;
  s.ending = undefined;
  s.party = { style: cfg.style, items, index: 0, board: {}, results: {}, votes: {}, agrees: [], opinions: {}, boards: {}, submitted: [], from: 0, target, points: {} } satisfies TierState;
  openBoard(s, now);
}

function openBoard(s: RoomState, now: number) {
  const t = st(s);
  if (collective(t.style)) openItem(s, now);
  else {
    t.submitted = [];
    setPhase(s, "tier_board", now, s.settings.tier.boardSec);
  }
}

function openItem(s: RoomState, now: number) {
  const t = st(s);
  t.votes = {};
  t.placement = undefined;
  t.agrees = [];
  t.opinions = {};
  setPhase(s, "tier_item", now, s.settings.tier.itemSec);
}

const current = (s: RoomState) => st(s).items[st(s).index];

/** Secret vote for the item on the table. Everybody voted = it locks right away. */
export function voteTier(s: RoomState, uid: string, tier: TierRow, now: number) {
  const t = st(s);
  if (s.phase !== "tier_item" || t.style !== "vote" || !TIER_ROWS.includes(tier) || !playing(s).some((p) => p.id === uid)) return;
  t.votes[uid] = tier;
  if (playing(s).every((p) => t.votes[p.id])) s.phaseEndsAt = Math.min(s.phaseEndsAt, now + 600);
}

/** Free discussion: anybody moves the item; the mover agrees with it, the others' «موافق» resets. */
export function moveTier(s: RoomState, uid: string, tier: TierRow, now: number) {
  const t = st(s);
  if (s.phase !== "tier_item" || t.style !== "discuss" || !TIER_ROWS.includes(tier) || !playing(s).some((p) => p.id === uid)) return;
  t.placement = { tier, by: uid, at: now };
  t.agrees = [uid];
  t.opinions[uid] = tier;
  checkAgree(s, now);
}

/** «موافق»: a majority of the players locks the item where it is. */
export function agreeTier(s: RoomState, uid: string, now: number) {
  const t = st(s);
  if (s.phase !== "tier_item" || t.style !== "discuss" || !t.placement || !playing(s).some((p) => p.id === uid)) return;
  if (!t.agrees.includes(uid)) t.agrees.push(uid);
  t.opinions[uid] = t.placement.tier;
  checkAgree(s, now);
}

function checkAgree(s: RoomState, now: number) {
  const t = st(s);
  if (t.placement && t.agrees.length > playing(s).length / 2) lockItem(s, t.placement.tier, "placed", now);
}

/** Host: «ثبّت» (discussion: where it sits, or a given tier) and the tie-break of the vote. */
export function pinTier(s: RoomState, by: string, tier: TierRow | undefined, now: number) {
  if (by !== s.hostId) throw new Error("only the host");
  const t = st(s);
  if (s.phase === "tier_tiebreak" && tier) return lockItem(s, tier, "host", now);
  if (s.phase !== "tier_item") return;
  const chosen = tier ?? t.placement?.tier;
  if (chosen) lockItem(s, chosen, "host", now);
}

function lockItem(s: RoomState, tier: TierRow | null, how: ItemResult["how"], now: number) {
  const t = st(s);
  const item = current(s);
  if (!item) return;
  const opinions = t.style === "vote" ? { ...t.votes } : { ...t.opinions };
  const disagree = tier ? Object.values(opinions).filter((o) => o !== tier).length : 0;
  t.results[item.id] = { tier, how: tier ? how : "skipped", disagree, opinions };
  if (tier) {
    t.board[item.id] = tier;
    if (t.style === "vote" || s.settings.tier.points) for (const [uid, o] of Object.entries(opinions)) award(s, uid, proximityPoints(o, tier));
  }
  setPhase(s, "tier_result", now, s.stopping ? 0 : RESULT_SEC);
}

function award(s: RoomState, uid: string, pts: number) {
  const t = st(s);
  t.points[uid] = (t.points[uid] ?? 0) + pts;
  const p = s.players.find((x) => x.id === uid);
  if (p) p.score += pts;
}

/** Individual boards: put an item in a tier, «ما شفته», or take it back (null). */
export function placeBoard(s: RoomState, uid: string, itemId: string, place: Placement | null) {
  const t = st(s);
  if (s.phase !== "tier_board" || t.submitted.includes(uid) || !playing(s).some((p) => p.id === uid)) return;
  if (!t.items.some((x, i) => x.id === itemId && i >= t.from)) return;
  if (place !== null && place !== "unseen" && !TIER_ROWS.includes(place)) return;
  const b = (t.boards[uid] ??= {});
  if (place === null) delete b[itemId];
  else b[itemId] = place;
}

/** «خلصت»: my board is in. Everybody in = the reveal. */
export function submitBoard(s: RoomState, uid: string, now: number) {
  const t = st(s);
  if (s.phase !== "tier_board" || !playing(s).some((p) => p.id === uid)) return;
  if (!t.submitted.includes(uid)) t.submitted.push(uid);
  const need = t.style === "guess_friend" ? playing(s) : playing(s);
  if (need.every((p) => t.submitted.includes(p.id))) s.phaseEndsAt = Math.min(s.phaseEndsAt, now + 600);
}

/** Everybody's boards are compared: the average (or the friend's board) is the group's. */
function revealBoards(s: RoomState, now: number) {
  const t = st(s);
  const items = t.items.slice(t.from);
  const players = playing(s).map((p) => p.id);
  const tierOf = (uid: string, id: string): TierRow | null => {
    const v = t.boards[uid]?.[id];
    return v && v !== "unseen" ? v : null;
  };
  for (const it of items) {
    let final: TierRow | null;
    if (t.style === "guess_friend") final = t.target ? tierOf(t.target, it.id) : null;
    else final = averageTier(players.map((u) => tierOf(u, it.id)).filter((x): x is TierRow => !!x));
    const opinions: Record<string, TierRow> = {};
    for (const u of players) {
      if (t.style === "guess_friend" && u === t.target) continue;
      const v = tierOf(u, it.id);
      if (v) opinions[u] = v;
    }
    t.results[it.id] = { tier: final, how: final ? (t.style === "guess_friend" ? "placed" : "average") : "skipped", disagree: final ? Object.values(opinions).filter((o) => o !== final).length : 0, opinions };
    if (final) {
      t.board[it.id] = final;
      for (const [u, o] of Object.entries(opinions)) award(s, u, proximityPoints(o, final));
    }
  }
  setPhase(s, "tier_reveal", now, s.stopping ? 0 : REVEAL_SEC);
}

/** Host: on to the next part (from the reveal). */
export function continueTier(s: RoomState, by: string, now: number) {
  if (by !== s.hostId) throw new Error("only the host");
  if (s.phase === "tier_reveal" || s.phase === "tier_result") s.phaseEndsAt = now;
}

/** New items arrived («زد» / «مفتوح» / more remaining): same board, more items. */
export function appendTierItems(s: RoomState, items: TierItem[], now: number) {
  const t = st(s);
  s.want = 0;
  if (!items.length) {
    s.noMore = true;
    systemMsg(s, "خلصت العناصر المناسبة لهذا الموضوع", now);
    if (s.phase === "ending") finishGame(s, now);
    return;
  }
  const had = t.items.length;
  const known = new Set(t.items.map((x) => x.id));
  t.items.push(...items.filter((x) => !known.has(x.id)));
  if (s.phase !== "ending" && !(s.phase === "tier_reveal" && !collective(t.style))) return;
  s.ending = undefined;
  if (collective(t.style)) {
    t.index = had;
    openItem(s, now);
  } else {
    t.from = had;
    openBoard(s, now);
  }
}

export interface TierTick {
  changed?: boolean;
  finished?: boolean;
}

export function tickTier(s: RoomState, now: number): TierTick {
  const t = st(s);
  if (!t || now < s.phaseEndsAt) return {};
  if (s.phase === "tier_item") {
    if (t.style === "vote") {
      const d = decideVote(Object.values(t.votes));
      if (d.how === "tie") setPhase(s, "tier_tiebreak", now, s.stopping ? 0 : TIEBREAK_SEC);
      else lockItem(s, d.tier, d.how, now);
    } else lockItem(s, t.placement?.tier ?? null, "placed", now);
    return { changed: true };
  }
  if (s.phase === "tier_tiebreak") {
    // the host did not decide: the average, rounded up
    lockItem(s, averageTier(Object.values(t.votes)), "average", now);
    return { changed: true };
  }
  if (s.phase === "tier_result") {
    if (t.index + 1 < t.items.length && !s.stopping) {
      t.index++;
      openItem(s, now);
    } else if (s.want && !s.stopping) s.phaseEndsAt = now + 1000;
    else if (reachEnd(s, now) === "open") {
      s.want = OPEN_BATCH;
      s.phaseEndsAt = now + 1000;
    }
    return { changed: true, finished: s.phase === ("finished" as RoomState["phase"]) };
  }
  if (s.phase === "tier_board") {
    revealBoards(s, now);
    return { changed: true };
  }
  if (s.phase === "tier_reveal") {
    if (s.want && !s.stopping) s.phaseEndsAt = now + 1000;
    else reachEnd(s, now); // individual boards are one board: «مفتوح» means «زد» by hand
    return { changed: true, finished: s.phase === ("finished" as RoomState["phase"]) };
  }
  return {};
}

// ---------------------------------------------------------------------------
// End of the night: who agrees with the group, the outlier, the most disputed item

export interface TierStats {
  aligned?: { id: string; diff: number };
  outlier?: { id: string; diff: number };
  disputed?: { id: string; spread: number };
  agreed?: { id: string; spread: number };
  /** per player: mean distance (in tiers) from the group's board */
  diffs: Record<string, number>;
}

export function tierStats(t: Pick<TierState, "results">): TierStats {
  const sum: Record<string, { d: number; n: number }> = {};
  const spreads: { id: string; spread: number }[] = [];
  for (const [id, r] of Object.entries(t.results)) {
    const ops = Object.entries(r.opinions);
    if (r.tier) {
      for (const [u, o] of ops) {
        const x = (sum[u] ??= { d: 0, n: 0 });
        x.d += Math.abs(TIER_VALUE[o] - TIER_VALUE[r.tier]);
        x.n++;
      }
    }
    if (ops.length >= 2) {
      const vals = ops.map(([, o]) => TIER_VALUE[o]);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      spreads.push({ id, spread: Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length) });
    }
  }
  const diffs = Object.fromEntries(Object.entries(sum).map(([u, x]) => [u, Math.round((x.d / x.n) * 100) / 100]));
  const ranked = Object.entries(diffs).sort((a, b) => a[1] - b[1]);
  const byspread = [...spreads].sort((a, b) => b.spread - a.spread);
  return {
    diffs,
    aligned: ranked.length >= 2 ? { id: ranked[0][0], diff: ranked[0][1] } : undefined,
    outlier: ranked.length >= 2 && ranked.at(-1)![1] > ranked[0][1] ? { id: ranked.at(-1)![0], diff: ranked.at(-1)![1] } : undefined,
    disputed: byspread.length && byspread[0].spread > 0 ? byspread[0] : undefined,
    agreed: byspread.length ? byspread.at(-1) : undefined,
  };
}

/** Each player's own opinions (taste: the watch log ratings, recommendations). */
export function personalRatings(s: RoomState): { userId: string; workId: string; tier: TierRow }[] {
  const t = st(s);
  if (!t) return [];
  const out: { userId: string; workId: string; tier: TierRow }[] = [];
  for (const it of t.items) {
    if (it.kind !== "work" || !it.workId) continue;
    const r = t.results[it.id];
    if (t.style === "solo") {
      for (const [u, b] of Object.entries(t.boards)) if (b[it.id] && b[it.id] !== "unseen") out.push({ userId: u, workId: it.workId, tier: b[it.id] as TierRow });
    } else if (t.style === "guess_friend") {
      const v = t.target ? t.boards[t.target]?.[it.id] : undefined;
      if (t.target && v && v !== "unseen") out.push({ userId: t.target, workId: it.workId, tier: v });
    } else if (r) for (const [u, o] of Object.entries(r.opinions)) out.push({ userId: u, workId: it.workId, tier: o });
  }
  return out;
}

/** What gets archived («تير ليستاتنا»). */
export function tierArchive(s: RoomState) {
  const t = st(s);
  return {
    style: t.style,
    topic: s.settings.tier.topic,
    parent: s.settings.tier.parent,
    target: t.target,
    items: t.items.filter((it) => t.results[it.id]),
    board: t.board,
    results: t.results,
    boards: t.boards,
    points: t.points,
    stats: tierStats(t),
    players: s.players.filter((p) => !p.spectator).map((p) => ({ id: p.id, name: p.name, color: p.color, avatar: p.avatar })),
  };
}
export type TierArchive = ReturnType<typeof tierArchive>;

// ---------------------------------------------------------------------------
// What each player sees

export function tierView(s: RoomState, uid: string, image: (src: string) => string, audio: (src: string) => string) {
  const t = st(s);
  if (!t) return undefined;
  const pub = (it: TierItem) => ({ id: it.id, kind: it.kind, title: it.title, titleAr: it.titleAr, sub: it.sub, image: it.image ? image(it.image) : undefined, audio: it.audio ? audio(it.audio) : undefined });
  const col = collective(t.style);
  const reveal = s.phase === "tier_reveal" || s.phase === "ending" || s.phase === "finished";
  const locked = new Set(Object.keys(t.results));
  const visible = col ? t.items.filter((it, i) => i <= t.index || locked.has(it.id)) : t.items;
  const cur = col && (s.phase === "tier_item" || s.phase === "tier_tiebreak" || s.phase === "tier_result") ? current(s) : undefined;
  const curResult = cur && s.phase === "tier_result" ? t.results[cur.id] : undefined;
  return {
    style: t.style,
    items: visible.map(pub),
    from: t.from,
    board: t.board,
    current: cur ? pub(cur) : undefined,
    index: t.index,
    total: t.items.length,
    // vote: how many voted (not what), mine
    votes: t.style === "vote" ? Object.keys(t.votes).length : undefined,
    myVote: t.votes[uid],
    tiebreak: s.phase === "tier_tiebreak" ? { average: averageTier(Object.values(t.votes)) } : undefined,
    placement: t.placement,
    agrees: t.agrees,
    // after locking: the result and who said what
    result: curResult,
    // individual boards: mine while filling; everybody's at the reveal
    myBoard: t.boards[uid] ?? {},
    submitted: t.submitted,
    boards: reveal && !col ? t.boards : undefined,
    results: reveal || col ? Object.fromEntries(Object.entries(t.results).filter(([id]) => !cur || id !== cur.id || s.phase === "tier_result")) : undefined,
    stats: reveal ? tierStats(t) : undefined,
    points: t.points,
    target: t.target,
  };
}
export type TierView = NonNullable<ReturnType<typeof tierView>>;
