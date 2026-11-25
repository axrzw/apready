import type { Category, Character, ModeId, Theme, Tier, Work } from "./types";
import type { LibraryIndex } from "./library";
import { characterNames, personNames, workNames } from "./library";
import type { Candidate } from "./select";
import type { Rng } from "./rng";
import { pick, randomId, sample, shuffle } from "./rng";
import { buildHints, type Hint } from "./hints";
import { matchAnswer, redactNames } from "./match";
import { EFFECTS, POSTER_EFFECTS, type ImageEffectId } from "./effects";

export type AudioEffectId = "normal" | "fast" | "slow" | "reverse" | "first_second";

/** What the player sees. `src` stays on the server; the browser only gets a random token. */
export type Asset =
  | { type: "image"; src: string; effect: ImageEffectId; steps: number; seed: number; mask?: { x: number; y: number; w: number; h: number }[] }
  | { type: "audio"; src: string; effect: AudioEffectId; start: number; duration: number }
  | { type: "video"; src: string; muted: boolean };

export interface Choice {
  id: string;
  label: string;
  labelAr?: string;
  /** image shown with the choice (odd one out) — also served by token */
  image?: string;
}

export type AnswerType = "text" | "pick" | "order";

export interface Question {
  id: string;
  key: string;
  mode: ModeId;
  workId: string;
  category: Category;
  tier: Tier;
  promptAr: string;
  promptEn: string;
  assets: Asset[];
  /** text shown (plot with names hidden, VA roles...) */
  text?: string;
  /** items revealed one by one (tags) or shown together (links, timeline) */
  items?: { label: string; labelAr?: string; image?: string; year?: number }[];
  revealItems?: boolean;
  answerType: AnswerType;
  /** accepted names for text answers */
  names: string[];
  /** other names accepted for part of the points (the work when the answer is a character) */
  partial?: { names: string[]; factor: number };
  /** the thing the names belong to (an accepted alias vote adds the name to it) */
  entity?: { kind: "work" | "character"; id: string };
  /** ids an autocomplete pick may carry to be right (default: the entity id) */
  acceptIds?: string[];
  /** shown after the round */
  display: { title: string; titleAr?: string; sub?: string; image?: string };
  choices?: Choice[];
  correctChoice?: string;
  correctOrder?: string[];
  hints: Hint[];
  timeLimitMs: number;
  modeMultiplier?: number;
}

export interface BuildOptions {
  rng: Rng;
  /** poster effects the room allows */
  effects?: ImageEffectId[];
  /** scene difficulty: 1 still frame, 2 silent clip, 3 clip with sound (easiest) */
  sceneLevel?: 1 | 2 | 3;
  timeLimitMs?: number;
}

/** icon = lucide-react component name */
export const MODES: { id: ModeId; ar: string; en: string; icon: string }[] = [
  { id: "opening", ar: "الأوبننق", en: "Opening", icon: "AudioLines" },
  { id: "ending", ar: "الإندنق", en: "Ending", icon: "Music2" },
  { id: "ost", ar: "الأوست", en: "OST", icon: "Disc3" },
  { id: "audio_edit", ar: "الصوت المعدّل", en: "Edited audio", icon: "SlidersHorizontal" },
  { id: "scene", ar: "المشهد", en: "Scene", icon: "Clapperboard" },
  { id: "image", ar: "الصورة", en: "Image", icon: "Image" },
  { id: "poster", ar: "البوستر", en: "Poster", icon: "RectangleVertical" },
  { id: "shadow", ar: "الظل", en: "Shadow", icon: "UserRound" },
  { id: "eyes", ar: "العيون", en: "Eyes", icon: "Eye" },
  { id: "character_name", ar: "اسم الشخصية", en: "Character name", icon: "Tag" },
  { id: "tags", ar: "الوسوم", en: "Tags", icon: "Hash" },
  { id: "plot", ar: "القصة", en: "Plot", icon: "ScrollText" },
  { id: "voice_actor", ar: "مؤدي الصوت", en: "Voice actor", icon: "Mic" },
  { id: "common_link", ar: "الرابط المشترك", en: "Common link", icon: "Link2" },
  { id: "higher_lower", ar: "أعلى أو أقل", en: "Higher or lower", icon: "ArrowUpDown" },
  { id: "timeline", ar: "الترتيب الزمني", en: "Timeline", icon: "CalendarRange" },
  { id: "odd_one", ar: "الدخيل", en: "Odd one out", icon: "Shuffle" },
  { id: "song", ar: "اسم الأغنية أو الفنان", en: "Song or artist", icon: "Mic2" },
];

const WORK_Q = { ar: "وش هذا العمل؟", en: "Which work is this?" };

function cand(key: string, w: Work): Candidate {
  return { key, workId: w.id, tier: w.tier, category: w.category, year: w.year, genres: w.genres, studios: w.studios };
}

function mainChar(lib: LibraryIndex, w: Work): Character | undefined {
  return (lib.charsByWork.get(w.id) ?? []).find((c) => c.role === "MAIN");
}

function hintsFor(lib: LibraryIndex, w: Work, accepted: string[], answerName?: string): Hint[] {
  const mc = mainChar(lib, w);
  const va = mc?.voiceActorId ? lib.person.get(mc.voiceActorId) : undefined;
  return buildHints(w, { acceptedNames: accepted, answerName, mainVoiceActor: va ? { name: va.name, nameAr: va.nameAr } : undefined });
}

function themesOf(lib: LibraryIndex, type: Theme["type"]): Theme[] {
  return lib.themes.filter((t) => t.type === type && (t.audioClip || t.audioUrl || t.videoUrl) && lib.work.has(t.workId));
}

function imageChars(lib: LibraryIndex): Character[] {
  return lib.characters.filter((c) => c.imageUrl && lib.work.has(c.workId) && c.role !== "BACKGROUND");
}

const candCache = new WeakMap<LibraryIndex, Map<ModeId, Candidate[]>>();
const linkCache = new WeakMap<LibraryIndex, LinkGroup[]>();

/** All question material for a mode, as candidates for the selector (cached per library). */
export function candidatesFor(mode: ModeId, lib: LibraryIndex): Candidate[] {
  let m = candCache.get(lib);
  if (!m) candCache.set(lib, (m = new Map()));
  let c = m.get(mode);
  if (!c) m.set(mode, (c = computeCandidates(mode, lib)));
  return c;
}

function computeCandidates(mode: ModeId, lib: LibraryIndex): Candidate[] {
  const W = (id: string) => lib.work.get(id)!;
  switch (mode) {
    case "opening":
    case "audio_edit":
      return themesOf(lib, "OP").map((t) => cand(`${mode}:${t.id}`, W(t.workId)));
    case "ending":
      return themesOf(lib, "ED").map((t) => cand(`${mode}:${t.id}`, W(t.workId)));
    case "ost":
      return themesOf(lib, "OST").map((t) => cand(`${mode}:${t.id}`, W(t.workId)));
    case "song":
      return lib.themes.filter((t) => lib.work.has(t.workId) && (t.audioClip || t.audioUrl || t.videoUrl)).map((t) => cand(`song:${t.id}`, W(t.workId)));
    case "scene": {
      const out: Candidate[] = [];
      for (const m of lib.media) if (["frame", "clip", "clip_silent", "screenshot"].includes(m.kind) && lib.work.has(m.workId)) out.push(cand(`scene:${m.id}`, W(m.workId)));
      for (const w of lib.works) (w.screenshots ?? []).forEach((_, i) => out.push(cand(`scene:${w.id}:shot${i}`, w)));
      return out;
    }
    case "poster":
      return lib.works.filter((w) => w.posterUrl).map((w) => cand(`poster:${w.id}`, w));
    case "image":
    case "shadow":
    case "eyes":
    case "character_name":
      return imageChars(lib)
        .filter((c) => mode !== "eyes" || lib.work.get(c.workId)!.category !== "game")
        .map((c) => cand(`${mode}:${c.id}`, W(c.workId)));
    case "tags":
      return lib.works.filter((w) => w.tags.length >= 4).map((w) => cand(`tags:${w.id}`, w));
    case "plot":
      return lib.works.filter((w) => (w.synopsis?.length ?? 0) > 120).map((w) => cand(`plot:${w.id}`, w));
    case "voice_actor": {
      const out: Candidate[] = [];
      for (const [pid, roles] of lib.rolesByPerson) {
        if (new Set(roles.map((r) => r.workId)).size < 4) continue;
        for (const r of roles) if (r.role === "MAIN" && lib.work.has(r.workId)) out.push(cand(`voice_actor:${pid}|${r.id}`, W(r.workId)));
      }
      return out;
    }
    case "common_link":
      return linkGroups(lib).map((g) => ({ ...cand(`common_link:${g.kind}:${g.value}`, g.works[0]), workId: `link:${g.kind}:${g.value}` }));
    case "higher_lower":
    case "timeline":
      return lib.works.filter((w) => w.year && w.score).map((w) => cand(`${mode}:${w.id}`, w));
    case "odd_one":
      return lib.works.filter((w) => (lib.charsByWork.get(w.id) ?? []).filter((c) => c.imageUrl).length >= 3).map((w) => cand(`odd_one:${w.id}`, w));
  }
}

interface LinkGroup {
  kind: "studio" | "creator" | "voice" | "year";
  value: string;
  works: Work[];
  names: string[];
}

/** Groups of works that share one thing (studio, creator, voice actor, year). */
export function linkGroups(lib: LibraryIndex): LinkGroup[] {
  let g = linkCache.get(lib);
  if (!g) linkCache.set(lib, (g = computeLinkGroups(lib)));
  return g;
}

function computeLinkGroups(lib: LibraryIndex): LinkGroup[] {
  const groups = new Map<string, LinkGroup>();
  const add = (kind: LinkGroup["kind"], value: string, w: Work, names: string[]) => {
    const k = `${kind}:${value}`;
    const g = groups.get(k) ?? { kind, value, works: [], names };
    if (!g.works.includes(w)) g.works.push(w);
    groups.set(k, g);
  };
  for (const w of lib.works) {
    for (const s of w.studios.slice(0, 1)) add("studio", s, w, [s]);
    for (const c of w.creators ?? []) add("creator", c, w, [c]);
    if (w.year) add("year", String(w.year), w, [String(w.year), `سنة ${w.year}`]);
  }
  for (const [pid, roles] of lib.rolesByPerson) {
    const p = lib.person.get(pid);
    if (!p) continue;
    for (const r of roles) {
      const w = lib.work.get(r.workId);
      if (w) add("voice", pid, w, personNames(p));
    }
  }
  return [...groups.values()].filter((g) => g.works.length >= 3);
}

/** 4 choices: the answer + 3 works of the same category, close in tier and era. */
export function workChoices(lib: LibraryIndex, w: Work, rng: Rng): { choices: Choice[]; correct: string } {
  const same = lib.works.filter((x) => x.id !== w.id && x.category === w.category);
  const close = same.filter((x) => x.tier === w.tier || Math.abs((x.year ?? 0) - (w.year ?? 0)) <= 5);
  const pool = close.length >= 3 ? close : same.length >= 3 ? same : lib.works.filter((x) => x.id !== w.id);
  // never two choices with the same name (sequels)
  const others: Work[] = [];
  for (const x of shuffle(pool, rng)) {
    if (others.length >= 3) break;
    if (matchAnswer(x.title, workNames(w)).ok || others.some((o) => o.title === x.title)) continue;
    others.push(x);
  }
  const correct = randomId(rng, 8);
  const choices = shuffle(
    [{ id: correct, label: w.title, labelAr: w.titleAr }, ...others.map((o) => ({ id: randomId(rng, 8), label: o.title, labelAr: o.titleAr }))],
    rng,
  );
  return { choices, correct };
}

export function characterChoices(lib: LibraryIndex, c: Character, rng: Rng): { choices: Choice[]; correct: string } {
  const w = lib.work.get(c.workId)!;
  const pool = lib.characters.filter((x) => x.workId !== c.workId && lib.work.get(x.workId)?.category === w.category);
  const others = sample(pool.length >= 3 ? pool : lib.characters.filter((x) => x.id !== c.id), 3, rng);
  const correct = randomId(rng, 8);
  return {
    choices: shuffle([{ id: correct, label: c.name, labelAr: c.nameAr }, ...others.map((o) => ({ id: randomId(rng, 8), label: o.name, labelAr: o.nameAr }))], rng),
    correct,
  };
}

function base(mode: ModeId, key: string, w: Work, o: BuildOptions): Omit<Question, "promptAr" | "promptEn" | "assets" | "answerType" | "names" | "display" | "hints"> {
  return { id: randomId(o.rng), key, mode, workId: w.id, category: w.category, tier: w.tier, timeLimitMs: o.timeLimitMs ?? 30_000 };
}

function workAnswer(lib: LibraryIndex, w: Work, rng: Rng) {
  const names = workNames(w);
  const { choices, correct } = workChoices(lib, w, rng);
  return { names, choices, correctChoice: correct, entity: { kind: "work" as const, id: w.id }, display: { title: w.title, titleAr: w.titleAr, image: w.posterUrl, sub: w.year ? String(w.year) : undefined } };
}

function seed(rng: Rng) {
  return Math.floor(rng() * 1e9);
}

/** Builds the question for a selected candidate. Returns null if the material is gone. */
export function buildQuestion(mode: ModeId, c: Candidate, lib: LibraryIndex, o: BuildOptions): Question | null {
  const rng = o.rng;
  const id = c.key.slice(mode.length + 1);
  const w = lib.work.get(c.workId);
  switch (mode) {
    case "opening":
    case "ending":
    case "ost":
    case "audio_edit": {
      const t = lib.theme.get(id);
      if (!t || !w) return null;
      const effect: AudioEffectId = mode === "audio_edit" ? pick(["fast", "slow", "reverse", "first_second"] as const, rng) : "normal";
      const ans = workAnswer(lib, w, rng);
      const label = { OP: ["أوبننق", "opening"], ED: ["إندنق", "ending"], OST: ["أوست", "OST"] }[t.type];
      const effAr = { normal: "", fast: " (مسرّع)", slow: " (بطيء)", reverse: " (مقلوب)", first_second: " (أول ثانية بس!)" }[effect];
      return {
        ...base(mode, c.key, w, o),
        promptAr: `${label[0]} أي عمل؟${effAr}`,
        promptEn: `Which work is this ${label[1]} from?`,
        assets: [{ type: "audio", src: t.audioClip ?? t.audioUrl ?? t.videoUrl!, effect, start: 0, duration: effect === "first_second" ? 1 : 25 }],
        answerType: "text",
        ...ans,
        display: { ...ans.display, sub: `${t.type}${t.seq ?? ""}: ${t.song} — ${t.artists.join("، ")}` },
        hints: hintsFor(lib, w, ans.names),
        modeMultiplier: effect === "first_second" ? 1.6 : effect === "normal" ? 1 : 1.3,
      };
    }
    case "song": {
      const t = lib.theme.get(id);
      if (!t || !w) return null;
      const names = [t.song, ...t.artists];
      const correct = randomId(rng, 8);
      const others = sample(lib.themes.filter((x) => x.song !== t.song), 3, rng);
      return {
        ...base(mode, c.key, w, o),
        promptAr: "وش اسم الأغنية أو مين الفنان؟",
        promptEn: "Name the song or the artist",
        assets: [{ type: "audio", src: t.audioClip ?? t.audioUrl ?? t.videoUrl!, effect: "normal", start: 0, duration: 25 }],
        answerType: "text",
        names,
        acceptIds: [`song:${t.id}`, ...t.artists.map((a) => `artist:${a}`)],
        choices: shuffle([{ id: correct, label: `${t.song} — ${t.artists.join(", ")}` }, ...others.map((x) => ({ id: randomId(rng, 8), label: `${x.song} — ${x.artists.join(", ")}` }))], rng),
        correctChoice: correct,
        display: { title: t.song, sub: `${t.artists.join("، ")} · ${w.title}`, image: w.posterUrl },
        hints: [
          { level: 1, kind: "format", ar: `${t.type} من ${w.titleAr ?? w.title}`, en: `${t.type} of ${w.title}`, cost: 0.1 },
          { level: 2, kind: "letters", ar: `عدد كلمات الأغنية: ${t.song.split(/\s+/).length}، أول حرف «${t.song[0]}»`, en: `${t.song.split(/\s+/).length} words, starts with "${t.song[0]}"`, cost: 0.2 },
        ],
      };
    }
    case "scene": {
      if (!w) return null;
      const m = lib.mediaById.get(id);
      const level = o.sceneLevel ?? 1;
      const assets: Asset[] = [];
      if (m && (m.kind === "clip" || m.kind === "clip_silent")) {
        // the picture is always the silent clip; with sound, the audio comes as its own audio-only file (SPEC 3)
        const n = m.id.split(":").pop();
        const silent = m.kind === "clip_silent" ? m : lib.media.find((x) => x.kind === "clip_silent" && x.meta?.theme === m.meta?.theme && x.id.split(":").pop() === n);
        const sound = m.kind === "clip" ? m : lib.media.find((x) => x.kind === "clip" && x.meta?.theme === m.meta?.theme && x.id.split(":").pop() === n);
        if (!silent) return null;
        assets.push({ type: "video", src: silent.src, muted: true });
        if (level === 3 && sound) assets.push({ type: "audio", src: sound.src, effect: "normal", start: 0, duration: 4 });
      } else {
        const src = m?.src ?? w.screenshots?.[Number(id.split(":shot").pop())];
        if (!src) return null;
        assets.push({ type: "image", src, effect: "tiles", steps: EFFECTS.tiles.steps, seed: seed(rng) });
      }
      const ans = workAnswer(lib, w, rng);
      return { ...base(mode, c.key, w, o), promptAr: "من أي عمل هذا المشهد؟", promptEn: "Which work is this scene from?", assets, answerType: "text", ...ans, hints: hintsFor(lib, w, ans.names) };
    }
    case "poster": {
      if (!w?.posterUrl) return null;
      const allowed = (o.effects?.length ? o.effects : POSTER_EFFECTS).filter((e) => EFFECTS[e]?.poster);
      const effect = pick(allowed.length ? allowed : POSTER_EFFECTS, rng);
      const ans = workAnswer(lib, w, rng);
      return {
        ...base(mode, c.key, w, o),
        promptAr: `${WORK_Q.ar} (${EFFECTS[effect].ar})`,
        promptEn: `${WORK_Q.en} (${EFFECTS[effect].en})`,
        assets: [{ type: "image", src: w.posterUrl, effect, steps: EFFECTS[effect].steps, seed: seed(rng), mask: w.posterBoxes }],
        answerType: "text",
        ...ans,
        hints: hintsFor(lib, w, ans.names),
        modeMultiplier: 1 + (EFFECTS[effect].difficulty - 1) * 0.15,
      };
    }
    case "image":
    case "shadow":
    case "eyes":
    case "character_name": {
      const ch = lib.character.get(id);
      if (!ch?.imageUrl || !w) return null;
      const effect: ImageEffectId = mode === "shadow" ? "silhouette" : mode === "eyes" ? "eyes" : mode === "image" ? pick(["crop", "blur", "zoom"] as const, rng) : "none";
      const asset: Asset = { type: "image", src: ch.imageUrl, effect, steps: EFFECTS[effect].steps, seed: seed(rng) };
      if (mode === "image") {
        const ans = workAnswer(lib, w, rng);
        return { ...base(mode, c.key, w, o), promptAr: "هذي الشخصية من أي عمل؟", promptEn: "Which work is this character from?", assets: [asset], answerType: "text", ...ans, display: { ...ans.display, sub: ch.name }, hints: hintsFor(lib, w, [...ans.names, ...characterNames(ch)]) };
      }
      const names = characterNames(ch);
      const { choices, correct } = characterChoices(lib, ch, rng);
      return {
        ...base(mode, c.key, w, o),
        promptAr: mode === "character_name" ? "وش اسم هذي الشخصية؟" : mode === "shadow" ? "مين صاحب هذا الظل؟" : "عيون مين هذي؟",
        promptEn: mode === "character_name" ? "Name this character" : mode === "shadow" ? "Whose shadow is this?" : "Whose eyes are these?",
        assets: [asset],
        answerType: "text",
        names,
        partial: mode === "character_name" ? undefined : { names: workNames(w), factor: 0.4 },
        entity: { kind: "character", id: ch.id },
        choices,
        correctChoice: correct,
        display: { title: ch.name, titleAr: ch.nameAr, sub: w.titleAr ?? w.title, image: ch.imageUrl },
        hints: hintsFor(lib, w, [...names, ...workNames(w)], ch.nameAr ?? ch.name),
        modeMultiplier: mode === "eyes" ? 1.4 : mode === "shadow" ? 1.2 : 1,
      };
    }
    case "tags": {
      if (!w) return null;
      const ans = workAnswer(lib, w, rng);
      const tags = shuffle(w.tags, rng).slice(0, 8);
      return {
        ...base(mode, c.key, w, o),
        promptAr: "خمّن العمل من الوسوم (تنكشف وحدة وحدة)",
        promptEn: "Guess the work from its tags",
        assets: [],
        items: tags.map((t) => ({ label: redactNames(t, ans.names, "؟؟") })),
        revealItems: true,
        answerType: "text",
        ...ans,
        hints: hintsFor(lib, w, ans.names).filter((h) => h.kind !== "tags"),
      };
    }
    case "plot": {
      if (!w?.synopsis) return null;
      const ans = workAnswer(lib, w, rng);
      const charNames = (lib.charsByWork.get(w.id) ?? []).flatMap(characterNames);
      const text = redactNames(w.synopsis.slice(0, 900), [...ans.names, ...charNames], "▇▇▇");
      return { ...base(mode, c.key, w, o), promptAr: "وش العمل من قصته؟ (الأسماء محجوبة)", promptEn: "Which work has this plot? (names hidden)", assets: [], text, answerType: "text", ...ans, hints: hintsFor(lib, w, ans.names), timeLimitMs: o.timeLimitMs ?? 45_000 };
    }
    case "voice_actor": {
      const [pid, charId] = id.split("|");
      const p = lib.person.get(pid);
      const ch = lib.character.get(charId);
      if (!p || !ch || !w) return null;
      const roles = shuffle((lib.rolesByPerson.get(pid) ?? []).filter((r) => r.workId !== w.id && lib.work.has(r.workId)), rng).slice(0, 4);
      const names = characterNames(ch);
      const { choices, correct } = characterChoices(lib, ch, rng);
      return {
        ...base(mode, c.key, w, o),
        promptAr: `هذا المؤدي أدّى هذي الأدوار. مين شخصيته في «${w.titleAr ?? w.title}»؟`,
        promptEn: `This voice actor played these roles. Who do they voice in "${w.title}"?`,
        assets: [],
        items: roles.map((r) => ({ label: `${r.name} — ${lib.work.get(r.workId)!.title}`, labelAr: `${r.nameAr ?? r.name} — ${lib.work.get(r.workId)!.titleAr ?? lib.work.get(r.workId)!.title}`, image: r.imageUrl })),
        answerType: "text",
        names,
        choices,
        correctChoice: correct,
        entity: { kind: "character", id: ch.id },
        display: { title: ch.name, titleAr: ch.nameAr, sub: `${p.nameAr ?? p.name}`, image: ch.imageUrl },
        hints: [{ level: 1, kind: "voice", ar: `اسم المؤدي: ${p.nameAr ?? p.name}`, en: `Voice actor: ${p.name}`, cost: 0.15 }, ...hintsFor(lib, w, [...names, ...workNames(w)], ch.name).filter((h) => h.kind === "letters")],
      };
    }
    case "common_link": {
      const [kind, ...rest] = id.split(":");
      const value = rest.join(":");
      const g = linkGroups(lib).find((x) => x.kind === kind && x.value === value);
      if (!g) return null;
      const works = sample(g.works, 3, rng);
      const kindAr = { studio: "استوديو/مطوّر", creator: "مؤلف", voice: "مؤدي صوت", year: "سنة" }[g.kind];
      const display = g.kind === "voice" ? (lib.person.get(g.value)?.name ?? g.value) : g.value;
      const pseudo = works[0];
      const correct = randomId(rng, 8);
      const others = sample(linkGroups(lib).filter((x) => x.kind === g.kind && x.value !== g.value), 3, rng);
      return {
        ...base(mode, c.key, pseudo, o),
        workId: pseudo.id,
        promptAr: "وش الشي المشترك بين هذي الأعمال؟ (استوديو، مؤلف، مؤدي صوت، أو سنة)",
        promptEn: "What links these works? (studio, author, voice actor or year)",
        assets: [],
        items: works.map((x) => ({ label: x.title, labelAr: x.titleAr, image: x.posterUrl })),
        answerType: "text",
        names: g.names,
        choices: shuffle(
          [{ id: correct, label: display }, ...others.map((x) => ({ id: randomId(rng, 8), label: x.kind === "voice" ? (lib.person.get(x.value)?.name ?? x.value) : x.value }))],
          rng,
        ),
        correctChoice: correct,
        display: { title: display, sub: kindAr },
        hints: [{ level: 1, kind: "format", ar: `نوع الرابط: ${kindAr}`, en: `Link type: ${g.kind}`, cost: 0.15 }],
        timeLimitMs: o.timeLimitMs ?? 40_000,
      };
    }
    case "higher_lower": {
      if (!w) return null;
      const by = pick(["score", "popularity"] as const, rng);
      const other = pick(lib.works.filter((x) => x.category === w.category && x.id !== w.id && x[by] !== undefined && x[by] !== w[by]), rng);
      if (!other) return null;
      const a = randomId(rng, 8);
      const b = randomId(rng, 8);
      const winner = (w[by] ?? 0) > (other[by] ?? 0) ? a : b;
      const label = by === "score" ? ["تقييمه أعلى", "higher score"] : ["شعبيته أعلى", "more popular"];
      return {
        ...base(mode, c.key, w, o),
        promptAr: `أي واحد ${label[0]}؟`,
        promptEn: `Which one has the ${label[1]}?`,
        assets: [],
        items: [w, other].map((x) => ({ label: x.title, labelAr: x.titleAr, image: x.posterUrl })),
        answerType: "pick",
        names: [],
        choices: [
          { id: a, label: w.title, labelAr: w.titleAr },
          { id: b, label: other.title, labelAr: other.titleAr },
        ],
        correctChoice: winner,
        display: { title: by === "score" ? `${w.title}: ${w.score} · ${other.title}: ${other.score}` : `${w.title}: ${w.popularity.toLocaleString()} · ${other.title}: ${other.popularity.toLocaleString()}` },
        hints: [],
        timeLimitMs: o.timeLimitMs ?? 15_000,
      };
    }
    case "timeline": {
      if (!w) return null;
      const years = new Set([w.year]);
      const picked: Work[] = [w];
      for (const x of shuffle(lib.works.filter((x) => x.year && x.id !== w.id), rng)) {
        if (picked.length >= 5) break;
        if (years.has(x.year)) continue;
        years.add(x.year);
        picked.push(x);
      }
      if (picked.length < 5) return null;
      const ids = picked.map(() => randomId(rng, 8));
      const order = picked.map((x, i) => [x.year!, ids[i]] as const).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
      const shuffled = shuffle(picked.map((x, i) => ({ x, id: ids[i] })), rng);
      return {
        ...base(mode, c.key, w, o),
        promptAr: "رتّبها من الأقدم للأحدث",
        promptEn: "Order them from oldest to newest",
        assets: [],
        answerType: "order",
        names: [],
        choices: shuffled.map(({ x, id }) => ({ id, label: x.title, labelAr: x.titleAr })),
        items: shuffled.map(({ x }) => ({ label: x.title, labelAr: x.titleAr, image: x.posterUrl })),
        correctOrder: order,
        display: { title: picked.slice().sort((p, q) => p.year! - q.year!).map((x) => `${x.year} ${x.title}`).join("، ") },
        hints: [],
        timeLimitMs: o.timeLimitMs ?? 45_000,
      };
    }
    case "odd_one": {
      if (!w) return null;
      const own = sample((lib.charsByWork.get(w.id) ?? []).filter((x) => x.imageUrl), 3, rng);
      const intruder = pick(lib.characters.filter((x) => x.imageUrl && x.workId !== w.id && lib.work.get(x.workId)?.category === w.category), rng);
      if (own.length < 3 || !intruder) return null;
      const iw = lib.work.get(intruder.workId)!;
      const ids = [...own, intruder].map(() => randomId(rng, 8));
      const list = shuffle([...own, intruder].map((ch, i) => ({ ch, id: ids[i] })), rng);
      return {
        ...base(mode, c.key, w, o),
        promptAr: "مين الدخيل؟ ثلاثة من نفس العمل وواحد لا",
        promptEn: "Which one is from a different work?",
        assets: [],
        answerType: "pick",
        names: [],
        choices: list.map(({ ch, id }) => ({ id, label: ch.name, labelAr: ch.nameAr, image: ch.imageUrl })),
        correctChoice: ids[3],
        display: { title: `${intruder.name} (${iw.title})`, sub: `الباقين من ${w.titleAr ?? w.title}`, image: intruder.imageUrl },
        hints: [],
        timeLimitMs: o.timeLimitMs ?? 20_000,
      };
    }
  }
}

export interface Check {
  correct: boolean;
  /** 1 = full points, <1 partial (work instead of character, timeline half right) */
  factor: number;
  alias?: string;
}

/** Checks an answer on the server. */
export function checkAnswer(q: Question, a: { text?: string; choice?: string; order?: string[]; entityId?: string }): Check {
  if (q.answerType === "order") {
    const got = a.order ?? [];
    const right = q.correctOrder!.filter((id, i) => got[i] === id).length;
    return { correct: right === q.correctOrder!.length, factor: right === q.correctOrder!.length ? 1 : right / q.correctOrder!.length / 2 };
  }
  if (a.choice !== undefined) return { correct: a.choice === q.correctChoice, factor: a.choice === q.correctChoice ? 1 : 0 };
  if (a.entityId !== undefined) {
    // picked from the autocomplete list: a sure match by id
    const ok = (q.acceptIds ?? (q.entity ? [q.entity.id] : [])).includes(a.entityId);
    if (ok) return { correct: true, factor: 1 };
    if (q.partial && a.entityId === q.workId) return { correct: false, factor: q.partial.factor };
    return { correct: false, factor: 0 };
  }
  const m = matchAnswer(a.text ?? "", q.names);
  if (m.ok) return { correct: true, factor: 1, alias: m.alias };
  if (q.partial) {
    const p = matchAnswer(a.text ?? "", q.partial.names);
    if (p.ok) return { correct: false, factor: q.partial.factor, alias: p.alias };
  }
  return { correct: false, factor: 0 };
}

/** What the browser may see: no names, no correct choice, no file paths. */
export interface PublicQuestion {
  id: string;
  mode: ModeId;
  category: Category;
  promptAr: string;
  promptEn: string;
  assets: ({ type: "image"; url: string; steps: number } | { type: "audio"; url: string } | { type: "video"; url: string; muted: boolean })[];
  text?: string;
  items?: { label: string; labelAr?: string; image?: string }[];
  revealItems?: boolean;
  answerType: AnswerType;
  choices?: { id: string; label: string; labelAr?: string; image?: string }[];
  hintCount: number;
  timeLimitMs: number;
}

export function publicQuestion(q: Question, assetUrl: (a: Asset, i: number) => string, imageUrl: (src: string) => string, withChoices: boolean): PublicQuestion {
  return {
    id: q.id,
    mode: q.mode,
    category: q.category,
    promptAr: q.promptAr,
    promptEn: q.promptEn,
    assets: q.assets.map((a, i) =>
      a.type === "image" ? { type: "image", url: assetUrl(a, i), steps: a.steps } : a.type === "audio" ? { type: "audio", url: assetUrl(a, i) } : { type: "video", url: assetUrl(a, i), muted: a.muted },
    ),
    text: q.text,
    items: q.items?.map((it) => ({ label: it.label, labelAr: it.labelAr, image: it.image ? imageUrl(it.image) : undefined })),
    revealItems: q.revealItems,
    answerType: q.answerType,
    choices:
      q.answerType !== "text" || withChoices ? q.choices?.map((c) => ({ id: c.id, label: c.label, labelAr: c.labelAr, image: c.image ? imageUrl(c.image) : undefined })) : undefined,
    hintCount: q.hints.length,
    timeLimitMs: q.timeLimitMs,
  };
}

/** Suggestions while typing: names that start with / contain the input, from the whole library (never only the answer). */
export function suggest(lib: LibraryIndex, input: string, kind: "work" | "character" = "work", limit = 8): string[] {
  const n = input.trim().toLowerCase();
  if (n.length < 2) return [];
  const out = new Set<string>();
  const names = kind === "work" ? lib.works.flatMap((w) => [w.titleAr, w.title].filter(Boolean) as string[]) : lib.characters.flatMap((c) => [c.nameAr, c.name].filter(Boolean) as string[]);
  for (const name of names) {
    if (name.toLowerCase().startsWith(n)) out.add(name);
    if (out.size >= limit) break;
  }
  if (out.size < limit)
    for (const name of names) {
      if (name.toLowerCase().includes(n)) out.add(name);
      if (out.size >= limit) break;
    }
  return [...out].sort((a, b) => a.localeCompare(b)).slice(0, limit);
}
