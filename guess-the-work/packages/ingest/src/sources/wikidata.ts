import type { Http } from "../http";

export const SPARQL_URL = "https://query.wikidata.org/sparql";

/** Wikidata properties that hold the id of a work in each source */
export const WD_PROPS = {
  anilist: "P8729", // AniList anime ID
  mal: "P4086", // MyAnimeList anime ID
  igdb: "P5794", // IGDB game ID (slug)
  tmdbMovie: "P4947",
  tmdbTv: "P4983",
  vndb: "P1933",
  tvmaze: "P8600",
} as const;

export interface ArabicNames {
  label?: string;
  aliases: string[];
}

interface SparqlResp {
  results: { bindings: { id: { value: string }; ar?: { value: string }; alt?: { value: string } }[] };
}

export function arabicQuery(prop: string): string {
  return `SELECT ?id ?ar ?alt WHERE {
  ?item wdt:${prop} ?id .
  OPTIONAL { ?item rdfs:label ?ar . FILTER(LANG(?ar) = "ar") }
  OPTIONAL { ?item skos:altLabel ?alt . FILTER(LANG(?alt) = "ar") }
  FILTER(BOUND(?ar) || BOUND(?alt))
}`;
}

export function parseArabic(resp: SparqlResp): Map<string, ArabicNames> {
  const m = new Map<string, ArabicNames>();
  for (const b of resp.results.bindings) {
    const id = b.id.value;
    const cur = m.get(id) ?? { aliases: [] };
    if (b.ar?.value && !cur.label) cur.label = b.ar.value;
    if (b.alt?.value && !cur.aliases.includes(b.alt.value)) cur.aliases.push(b.alt.value);
    m.set(id, cur);
  }
  return m;
}

/** One query returns every Arabic name for all works that have this property. */
export async function arabicNames(http: Http, prop: string): Promise<Map<string, ArabicNames>> {
  const url = `${SPARQL_URL}?format=json&query=${encodeURIComponent(arabicQuery(prop))}`;
  const resp = await http.json<SparqlResp>(url, { headers: { accept: "application/sparql-results+json" } });
  return parseArabic(resp);
}
