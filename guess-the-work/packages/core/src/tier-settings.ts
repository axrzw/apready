import type { Tier } from "./types";

/** «تير ليست» settings (own file: room.ts needs the defaults without loading the game). */
export type TierStyle = "vote" | "discuss" | "solo" | "guess_friend";
export const TIER_STYLES: TierStyle[] = ["vote", "discuss", "solo", "guess_friend"];
export type TierTopicType = "anime" | "series" | "movie" | "game" | "character" | "opening" | "ending" | "ost" | "custom";
export const TIER_TOPICS: TierTopicType[] = ["anime", "series", "movie", "game", "character", "opening", "ending", "ost", "custom"];

export interface TierTopic {
  type: TierTopicType;
  /** custom: categories; any topic: the filters below */
  categories?: string[];
  yearFrom?: number | null;
  yearTo?: number | null;
  /** "WINTER" | "SPRING" | "SUMMER" | "FALL" (with yearFrom = the year) */
  season?: string;
  studio?: string;
  genre?: string;
  tag?: string;
  popTier?: Tier | "";
}

export interface TierSettings {
  style: TierStyle;
  topic: TierTopic;
  source: "any" | "someone" | "everyone" | "manual";
  /** manual items: "w:<workId>" | "c:<characterId>" | "t:<themeId>" */
  manual: string[];
  /** free discussion: points by how close each player's opinion was */
  points: boolean;
  /** seconds per item (collective) */
  itemSec: number;
  /** seconds to fill a whole board (individual / guess a friend) */
  boardSec: number;
  /** «خمّن تير صاحبك»: whose board (default: the host) */
  target?: string;
  /** «عيدها»: the archived tier list this one repeats (for the comparison) */
  parent?: string;
}

export const DEFAULT_TIER_SETTINGS: TierSettings = { style: "vote", topic: { type: "anime" }, source: "any", manual: [], points: true, itemSec: 30, boardSec: 150 };

