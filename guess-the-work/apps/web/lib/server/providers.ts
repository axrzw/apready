import "server-only";
import type { Work } from "@gtw/core/types";

/** Where to watch in Saudi Arabia (TMDB watch providers, region SA). Only with TMDB_API_KEY and a TMDB work. */
const cache = new Map<string, { at: number; names: string[] }>();

export async function providersSA(w: Work): Promise<string[]> {
  const key = process.env.TMDB_API_KEY;
  const m = /^tmdb-(movie|tv):(\d+)$/.exec(w.id);
  if (!key || !m) return [];
  const hit = cache.get(w.id);
  if (hit && Date.now() - hit.at < 86_400_000) return hit.names;
  const url = `https://api.themoviedb.org/3/${m[1]}/${m[2]}/watch/providers${key.length > 40 ? "" : `?api_key=${key}`}`;
  try {
    const r = await fetch(url, { headers: key.length > 40 ? { authorization: `Bearer ${key}` } : {} });
    const j = (await r.json()) as { results?: Record<string, { flatrate?: { provider_name: string }[]; rent?: { provider_name: string }[]; buy?: { provider_name: string }[] }> };
    const sa = j.results?.SA;
    const names = [...new Set([...(sa?.flatrate ?? []), ...(sa?.rent ?? []), ...(sa?.buy ?? [])].map((p) => p.provider_name))];
    cache.set(w.id, { at: Date.now(), names });
    return names;
  } catch {
    return [];
  }
}
