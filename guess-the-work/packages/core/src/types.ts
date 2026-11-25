export type Category = "anime" | "game" | "movie" | "series" | "vn" | "manga";
export const CATEGORIES: Category[] = ["anime", "game", "movie", "series", "vn", "manga"];

/** Room sections (SPEC 9): finer than categories, from category + sub-type. */
export type Section = "anime" | "donghua" | "series" | "asian_drama" | "movie" | "game" | "manga" | "vn";
export const SECTIONS: Section[] = ["anime", "donghua", "series", "asian_drama", "movie", "game", "manga", "vn"];
export function sectionOf(w: { category: Category; subtype?: string }): Section {
  if (w.category === "anime") return w.subtype === "donghua" ? "donghua" : "anime";
  if (w.category === "series") return ["kdrama", "cdrama", "jdrama", "thai"].includes(w.subtype ?? "") ? "asian_drama" : "series";
  return w.category;
}

export type Tier = "mainstream" | "mid" | "hidden_gem" | "obscure";
export const TIERS: Tier[] = ["mainstream", "mid", "hidden_gem", "obscure"];

export type TierMix = Record<Tier, number>;
export const DEFAULT_TIER_MIX: TierMix = { mainstream: 25, mid: 30, hidden_gem: 30, obscure: 15 };

/** A guessable thing with every accepted name. */
export interface Work {
  id: string; // "anilist:16498", "tmdb-tv:1399", "igdb:1942", "vndb:v17"
  category: Category;
  title: string; // main display name (English or romaji)
  titleAr?: string;
  aliases: string[]; // every other accepted name (romaji, native, Arabic dub, abbreviations...)
  format?: string; // TV, MOVIE, OVA, GAME, ...
  year?: number;
  season?: string; // WINTER, SPRING...
  genres: string[];
  tags: string[];
  studios: string[]; // studio / developer / director
  creators?: string[]; // author / original creator
  score?: number; // 0-100
  popularity: number; // source popularity (members, vote_count, rating count)
  tier: Tier;
  episodes?: number;
  durationHours?: number;
  synopsis?: string;
  posterUrl?: string;
  bannerUrl?: string;
  screenshots?: string[];
  sourceIds?: Record<string, string | number>;
  adult?: boolean;
  /** text areas on the poster found by OCR (hidden before any effect) */
  posterBoxes?: { x: number; y: number; w: number; h: number }[];
  /** currently airing (AniList status RELEASING) */
  airing?: boolean;
  /** anime | donghua | manga | manhwa | manhua | light_novel | western | kdrama | cdrama | jdrama | thai ... */
  subtype?: string;
}

export interface Person {
  id: string;
  name: string;
  nameAr?: string;
  aliases: string[];
  imageUrl?: string;
}

export interface Character {
  id: string;
  workId: string;
  name: string;
  nameAr?: string;
  aliases: string[];
  imageUrl?: string;
  role: "MAIN" | "SUPPORTING" | "BACKGROUND";
  voiceActorId?: string;
  favourites?: number;
}

export type ThemeType = "OP" | "ED" | "OST";
export interface Theme {
  id: string;
  workId: string;
  type: ThemeType;
  seq?: number;
  song: string;
  artists: string[];
  audioUrl?: string; // remote source
  videoUrl?: string;
  /** local processed files (relative to media dir) */
  audioClip?: string;
}

export type MediaKind = "frame" | "clip" | "clip_silent" | "audio" | "screenshot" | "poster" | "backdrop";
export interface MediaAsset {
  id: string;
  workId: string;
  kind: MediaKind;
  /** local path relative to the media dir, or a remote URL */
  src: string;
  meta?: Record<string, unknown>;
}

export type ModeId =
  | "opening"
  | "ending"
  | "ost"
  | "audio_edit"
  | "scene"
  | "image"
  | "poster"
  | "shadow"
  | "eyes"
  | "character_name"
  | "tags"
  | "plot"
  | "voice_actor"
  | "common_link"
  | "higher_lower"
  | "timeline"
  | "odd_one"
  | "song"
  | "season";

export type PartyModeId = "describer" | "drawer";

export type AnswerMethod = "text" | "choice";
