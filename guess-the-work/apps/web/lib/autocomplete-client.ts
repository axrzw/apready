"use client";
import { buildIndex, searchIndex, type Index, type Suggestion } from "@gtw/core/autocomplete";

export type AcKind = "work" | "character" | "song";
const loaded = new Map<AcKind, Promise<Index>>();

/** Downloads the index once per page load (the browser also caches it), builds it in memory. */
export function loadIndex(kind: AcKind): Promise<Index> {
  let p = loaded.get(kind);
  if (!p) {
    p = fetch(`/api/index?kind=${kind}`)
      .then((r) => r.json() as Promise<[string, string, string, number, string[]][]>)
      .then((rows) => buildIndex(rows.map(([id, label, labelAr, pop, names]) => ({ id, label, labelAr: labelAr || undefined, pop, names }))));
    p.catch(() => loaded.delete(kind));
    loaded.set(kind, p);
  }
  return p;
}

export function suggest(idx: Index, text: string, limit = 6): Suggestion[] {
  return searchIndex(idx, text, limit);
}
