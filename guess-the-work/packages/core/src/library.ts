import type { Character, MediaAsset, Person, Theme, Work } from "./types";

export interface Library {
  works: Work[];
  characters: Character[];
  people: Person[];
  themes: Theme[];
  media: MediaAsset[];
}

export interface LibraryIndex extends Library {
  work: Map<string, Work>;
  charsByWork: Map<string, Character[]>;
  person: Map<string, Person>;
  rolesByPerson: Map<string, Character[]>;
  themesByWork: Map<string, Theme[]>;
  mediaByWork: Map<string, MediaAsset[]>;
}

function group<T>(items: T[], key: (t: T) => string | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (!k) continue;
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export function indexLibrary(lib: Library): LibraryIndex {
  const works = lib.works.filter((w) => !w.adult);
  return {
    ...lib,
    works,
    work: new Map(works.map((w) => [w.id, w])),
    charsByWork: group(lib.characters, (c) => c.workId),
    person: new Map(lib.people.map((p) => [p.id, p])),
    rolesByPerson: group(lib.characters, (c) => c.voiceActorId),
    themesByWork: group(lib.themes, (t) => t.workId),
    mediaByWork: group(lib.media, (m) => m.workId),
  };
}

/** Every accepted name of a work. */
export function workNames(w: Work): string[] {
  return [w.title, w.titleAr, ...w.aliases].filter((x): x is string => !!x);
}

export function characterNames(c: Character): string[] {
  return [c.name, c.nameAr, ...c.aliases].filter((x): x is string => !!x);
}

export function personNames(p: Person): string[] {
  return [p.name, p.nameAr, ...p.aliases].filter((x): x is string => !!x);
}
