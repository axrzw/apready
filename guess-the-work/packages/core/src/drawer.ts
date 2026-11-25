import type { RoomState } from "./room";
import { systemMsg, reachEnd } from "./room";
import { matchAnswer } from "./match";
import { scoreAnswer, helperPoints } from "./scoring";
import { pickPartyItems, type PartyItem, type PickOptions } from "./party";
import type { LibraryIndex } from "./library";
import type { ScoredRow, TokenReq } from "./describer";
import { shuffle } from "./rng";

export interface Drawing {
  id: string;
  playerId: string;
  item: PartyItem;
  votesBest: number;
  votesFunny: number;
}

export interface DrawerState {
  offers: Record<string, PartyItem[]>;
  items: Record<string, PartyItem>;
  drawings: Drawing[];
  order: string[]; // drawing ids in showing order
  guessIdx: number;
  guesses: Record<string, Record<string, { work: boolean; specific: boolean; points: number }>>;
  votes: Record<string, { best?: string; funny?: string }>;
  /** 0-based round (settings.count rounds; «زد» adds more) */
  round?: number;
  /** rounds in this game (settings.count, plus «زد») */
  rounds?: number;
  /** items were asked for (next round) */
  requested?: boolean;
}

/** Bonus for also naming the character, on top of the work. */
export const SPECIFIC_BONUS = 0.5;

function st(s: RoomState): DrawerState {
  return s.party as DrawerState;
}

function setPhase(s: RoomState, phase: RoomState["phase"], now: number, sec: number) {
  s.phase = phase;
  s.phaseStartedAt = now;
  s.phaseEndsAt = sec === Infinity ? Infinity : now + sec * 1000;
}

export function pickDrawItems(lib: LibraryIndex, n: number, o: PickOptions): PartyItem[] {
  return pickPartyItems(lib, n, o, "drawer");
}

export function startDrawer(s: RoomState, by: string, items: PartyItem[], now: number) {
  if (by !== s.hostId) throw new Error("only the host");
  if (s.players.length < 2) throw new Error("يبي لاعبين على الأقل");
  if (items.length < s.players.length) throw new Error("ما فيه عناصر كفاية في المكتبة");
  for (const p of s.players) (p.score = 0), (p.streak = 0);
  s.party = emptyRound(0, Math.max(1, s.settings.count));
  s.questions = [];
  s.stopping = false;
  s.ending = undefined;
  giveRound(s, items, now);
}

function emptyRound(round: number, rounds: number): DrawerState {
  return { offers: {}, items: {}, drawings: [], order: [], guessIdx: 0, guesses: {}, votes: {}, round, rounds, requested: false };
}

export function roundsOf(s: RoomState): number {
  return st(s)?.rounds ?? Math.max(1, s.settings.count);
}

/** Items for this round: one or two per player, then the drawing clock starts. */
export function giveRound(s: RoomState, items: PartyItem[], now: number) {
  const d = st(s);
  const per = s.settings.draw.choose ? 2 : 1;
  d.requested = false;
  if (!items.length) return;
  s.players
    .filter((p) => !p.spectator)
    .forEach((p, i) => {
      const mine = items.slice(i * per, i * per + per);
      d.offers[p.id] = mine.length ? mine : [items[i % items.length]];
      if (d.offers[p.id].length === 1) d.items[p.id] = d.offers[p.id][0];
    });
  setPhase(s, "draw", now, s.settings.draw.drawSec);
}

/** Next round (or «زد» on the ending screen): items are asked for on the next tick. */
export function nextRound(s: RoomState, now: number) {
  const d = st(s);
  s.party = emptyRound((d?.round ?? 0) + 1, roundsOf(s));
  s.ending = undefined;
  setPhase(s, "draw", now, 15);
}

export function choose(s: RoomState, uid: string, index: number) {
  const d = st(s);
  if (s.phase !== "draw" || d.items[uid] || !d.offers[uid]?.[index]) return;
  d.items[uid] = d.offers[uid][index];
}

export function itemOf(s: RoomState, uid: string): PartyItem | undefined {
  const d = st(s);
  return d?.items[uid] ?? d?.offers[uid]?.[0];
}

export function submit(s: RoomState, uid: string, drawingId: string, now: number) {
  const d = st(s);
  if (s.phase !== "draw") return;
  const item = itemOf(s, uid);
  if (!item) return;
  d.items[uid] = item;
  d.drawings = d.drawings.filter((x) => x.playerId !== uid);
  d.drawings.push({ id: drawingId, playerId: uid, item, votesBest: 0, votesFunny: 0 });
  if (s.players.filter((p) => !p.spectator).every((p) => d.drawings.some((x) => x.playerId === p.id))) s.phaseEndsAt = Math.min(s.phaseEndsAt, now + 500);
}

function current(s: RoomState): Drawing | undefined {
  const d = st(s);
  return d.drawings.find((x) => x.id === d.order[d.guessIdx]);
}

export function guess(s: RoomState, uid: string, text: string, now: number) {
  const d = st(s);
  const cur = current(s);
  if (s.phase !== "draw_guess" || !cur) return { correct: false, points: 0 };
  if (cur.playerId === uid) return { correct: false, points: 0, own: true };
  const g = (d.guesses[cur.id] ??= {});
  const mine = (g[uid] ??= { work: false, specific: false, points: 0 });
  const it = cur.item;
  const base = () => scoreAnswer({ correct: true, elapsedMs: now - s.phaseStartedAt, timeLimitMs: s.phaseEndsAt - s.phaseStartedAt, tier: it.tier, method: "text", hintsUsed: 0, streak: 0, rank: 99 }, s.settings.scoring).total;
  const name = s.players.find((p) => p.id === uid)?.name;
  let hit = false;
  if (!mine.work && matchAnswer(text, it.workNames).ok) {
    mine.work = true;
    mine.points += base();
    hit = true;
    systemMsg(s, `${name} عرف العمل`, now);
  }
  if (it.kind === "character" && !mine.specific && matchAnswer(text, it.names).ok) {
    mine.specific = true;
    if (!mine.work) {
      mine.work = true;
      mine.points += base();
    }
    mine.points += Math.round(base() * SPECIFIC_BONUS);
    hit = true;
    systemMsg(s, `${name} عرف الشخصية بعد`, now);
  }
  if (!hit) s.chat.push({ id: (s.chat.at(-1)?.id ?? 0) + 1, at: now, playerId: uid, text, kind: "guess" });
  const guessers = s.players.filter((p) => p.id !== cur.playerId);
  if (guessers.every((p) => g[p.id]?.work && (it.kind === "work" || g[p.id]?.specific))) s.phaseEndsAt = Math.min(s.phaseEndsAt, now + 1500);
  return { correct: hit, points: mine.points };
}

export function vote(s: RoomState, uid: string, drawingId: string, kind: "best" | "funny") {
  const d = st(s);
  if (s.phase !== "draw_vote") return;
  const dr = d.drawings.find((x) => x.id === drawingId);
  if (!dr || dr.playerId === uid) return;
  const v = (d.votes[uid] ??= {});
  v[kind] = drawingId;
}

export function drawingsOf(s: RoomState) {
  return st(s)?.drawings ?? [];
}

export interface DrawTick {
  changed?: boolean;
  scored?: ScoredRow[];
  finished?: boolean;
  /** a new round needs items */
  needItems?: boolean;
  /** the round's votes are counted: store them */
  voted?: Drawing[];
}

export function tickDrawer(s: RoomState, now: number): DrawTick {
  const d = st(s);
  if (!d) return {};
  if (s.phase === "draw" && !Object.keys(d.offers).length) {
    // a new round: ask for items (again if they never came)
    if (!d.requested || now >= s.phaseEndsAt) {
      d.requested = true;
      s.phaseEndsAt = now + 15_000;
      return { changed: true, needItems: true };
    }
    return {};
  }
  if (now < s.phaseEndsAt) return {};
  if (s.phase === "draw") {
    if (!d.drawings.length) {
      setPhase(s, "finished", now, Infinity);
      return { changed: true, finished: true };
    }
    d.order = shuffle(d.drawings.map((x) => x.id), Math.random);
    d.guessIdx = 0;
    setPhase(s, "draw_guess", now, s.settings.draw.guessSec);
    return { changed: true };
  }
  if (s.phase === "draw_guess") {
    const cur = current(s)!;
    const g = d.guesses[cur.id] ?? {};
    const scored: ScoredRow[] = [];
    let helper = 0;
    for (const [pid, r] of Object.entries(g)) {
      const p = s.players.find((x) => x.id === pid);
      if (p) p.score += r.points;
      if (r.work) helper += helperPoints(r.points, s.settings.scoring);
      scored.push(row(cur.item, pid, r.points, r.work, "guesser"));
    }
    const drawer = s.players.find((x) => x.id === cur.playerId);
    if (drawer) drawer.score += helper;
    scored.push(row(cur.item, cur.playerId, helper, helper > 0, "drawer"));
    d.guessIdx++;
    if (d.guessIdx < d.order.length) setPhase(s, "draw_guess", now, s.settings.draw.guessSec);
    else setPhase(s, "draw_vote", now, s.settings.draw.voteSec);
    return { changed: true, scored };
  }
  if (s.phase === "draw_vote") {
    for (const v of Object.values(d.votes)) {
      if (v.best) d.drawings.find((x) => x.id === v.best)!.votesBest++;
      if (v.funny) d.drawings.find((x) => x.id === v.funny)!.votesFunny++;
    }
    // small bonus for the winners
    const top = (k: "votesBest" | "votesFunny") => [...d.drawings].sort((a, b) => b[k] - a[k])[0];
    for (const [k, bonus] of [["votesBest", 300], ["votesFunny", 200]] as const) {
      const w = top(k);
      if (w && w[k] > 0) {
        const p = s.players.find((x) => x.id === w.playerId);
        if (p) p.score += bonus;
      }
    }
    const voted = d.drawings.map((x) => ({ ...x }));
    const round = d.round ?? 0;
    if (round + 1 < roundsOf(s) && !s.stopping) nextRound(s, now);
    else if (reachEnd(s, now) === "open") nextRound(s, now);
    return { changed: true, voted, finished: (s.phase as RoomState["phase"]) === "finished" };
  }
  return {};
}

function row(item: PartyItem, userId: string, points: number, correct: boolean, role: "drawer" | "guesser"): ScoredRow {
  return { userId, questionKey: item.key, mode: "drawer", workId: item.workId, category: item.category, tier: item.tier, correct, points, method: "text", hintsUsed: 0, role };
}

export function drawerView(s: RoomState, uid: string, token: (r: TokenReq) => string, image: (src: string) => string) {
  const d = st(s);
  if (!d) return undefined;
  const priv = (src: string) => token({ asset: { type: "plain", src }, users: [uid] });
  const pngUrl = (id: string) => image(`drawings/${id}.png`);
  const cur = s.phase === "draw_guess" ? current(s) : undefined;
  const showAll = s.phase === "draw_vote" || s.phase === "finished" || s.phase === "ending";
  return {
    myOffers: s.phase === "draw" && !d.items[uid] ? d.offers[uid]?.map((it) => ({ title: it.display.title, titleAr: it.display.titleAr, sub: it.display.sub, image: priv(it.image) })) : undefined,
    myItem: s.phase === "draw" && d.items[uid] ? { title: d.items[uid].display.title, titleAr: d.items[uid].display.titleAr, sub: d.items[uid].display.sub, image: priv(d.items[uid].image), kind: d.items[uid].kind } : undefined,
    submitted: d.drawings.map((x) => x.playerId),
    current: cur
      ? {
          id: cur.id,
          by: cur.playerId,
          png: pngUrl(cur.id),
          index: d.guessIdx,
          total: d.order.length,
          kind: cur.item.kind,
          mine: d.guesses[cur.id]?.[uid] ? { work: d.guesses[cur.id][uid].work, specific: d.guesses[cur.id][uid].specific } : undefined,
        }
      : undefined,
    gallery: showAll
      ? d.drawings.map((x) => ({ id: x.id, by: x.playerId, png: pngUrl(x.id), original: image(x.item.image), title: x.item.display.title, titleAr: x.item.display.titleAr, sub: x.item.display.sub, votesBest: x.votesBest, votesFunny: x.votesFunny }))
      : undefined,
    myVotes: d.votes[uid],
    round: (d.round ?? 0) + 1,
    rounds: s.settings.pace?.open ? null : roundsOf(s),
  };
}
