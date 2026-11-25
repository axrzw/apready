/**
 * The group's own popularity (SPEC 5, 6, 9): from the watch log, independent of the global tiers.
 */
export type WatchStatus = "seen" | "watching" | "dropped" | "not_seen";
/** workId -> (userId -> status) */
export type WatchMap = Map<string, Map<string, WatchStatus>>;

export type GroupTier = "group_common" | "group_niche" | "group_unknown";
export const GROUP_TIERS: GroupTier[] = ["group_common", "group_niche", "group_unknown"];
export type GroupMix = Record<GroupTier, number>;
export const DEFAULT_GROUP_MIX: GroupMix = { group_common: 34, group_niche: 33, group_unknown: 33 };

export type QuestionSource = "any" | "someone" | "everyone";

const watched = (st?: WatchStatus) => st === "seen" || st === "watching" || st === "dropped";

export function seenBy(entry: Map<string, WatchStatus> | undefined, players: string[]): string[] {
  if (!entry) return [];
  return players.filter((p) => watched(entry.get(p)));
}

/** most of us (more than half) / one or a few / nobody */
export function groupTier(entry: Map<string, WatchStatus> | undefined, group: string[]): GroupTier {
  const n = seenBy(entry, group).length;
  if (n === 0) return "group_unknown";
  if (n > group.length / 2) return "group_common";
  return "group_niche";
}

export interface GroupFilter {
  source: QuestionSource;
  /** «استثنِ اللي شافه السائل»: skip works only one player in the room logged */
  excludeOwnOnly: boolean;
}

export function groupFilter(workId: string, watch: WatchMap, room: string[], f: GroupFilter): boolean {
  const seen = seenBy(watch.get(workId), room);
  if (f.source === "someone" && seen.length === 0) return false;
  if (f.source === "everyone" && seen.length < room.length) return false;
  if (f.excludeOwnOnly && room.length > 1 && seen.length === 1) return false;
  return true;
}

/**
 * «بدون حرق»: for anyone in the room who is watching it or has not seen it, no scene from the second half
 * (position 0-1 inside the work) and no ending of the last season.
 */
export function spoilerSafe(m: { workId: string; position?: number; lastEnding?: boolean }, watch: WatchMap, room: string[]): boolean {
  const entry = watch.get(m.workId);
  const atRisk = room.some((p) => {
    const st = entry?.get(p);
    return st !== "seen" && st !== "dropped";
  });
  if (!atRisk) return true;
  if (m.lastEnding) return false;
  if (m.position !== undefined && m.position > 0.5) return false;
  return true;
}
