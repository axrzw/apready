import "server-only";
import { indexLibrary, type LibraryIndex } from "@gtw/core/library";
import { getRepo } from "./repo";

const g = globalThis as unknown as { __gtwLib?: { at: number; lib: Promise<LibraryIndex> } };
const TTL = 5 * 60_000;

export function getLibrary(): Promise<LibraryIndex> {
  if (!g.__gtwLib || Date.now() - g.__gtwLib.at > TTL) {
    g.__gtwLib = { at: Date.now(), lib: getRepo().loadLibrary().then(indexLibrary) };
  }
  return g.__gtwLib.lib;
}

export function invalidateLibrary() {
  g.__gtwLib = undefined;
}
