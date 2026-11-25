import { indexLibrary, type Library } from "../src/library";
import type { Character, Tier, Work } from "../src/types";

const tiers: Tier[] = ["mainstream", "mid", "hidden_gem", "obscure"];

export function makeLibrary(n = 40): ReturnType<typeof indexLibrary> {
  const works: Work[] = [];
  const characters: Character[] = [];
  for (let i = 0; i < n; i++) {
    const id = `anilist:${i}`;
    works.push({
      id, category: i % 10 === 9 ? "game" : "anime", title: `Work Number ${i} Title`, titleAr: `عمل رقم ${i}`, aliases: [`WN${i}`],
      year: 1990 + i, season: "SPRING", genres: ["Action", i % 2 ? "Drama" : "Comedy"], tags: ["Tag A", "Tag B", "Tag C", "Tag D", `Work Number ${i} Title lore`],
      studios: [`Studio ${i % 4}`], creators: [`Author ${i % 5}`], score: 60 + (i % 30), popularity: 1000 * (i + 1), tier: tiers[i % 4], episodes: 12,
      synopsis: `Hero${i} lives in a city. Work Number ${i} Title is about Hero${i} and friends fighting monsters across a long journey with many twists and a great ending that nobody expects at all.`,
      posterUrl: `https://img.test/p${i}.jpg`, screenshots: [`https://img.test/s${i}.jpg`],
    });
    for (let k = 0; k < 4; k++)
      characters.push({ id: `c${i}-${k}`, workId: id, name: `Hero${i} Person${k}`, aliases: [`Hero${i}`], imageUrl: `https://img.test/c${i}-${k}.jpg`, role: k === 0 ? "MAIN" : "SUPPORTING", voiceActorId: `va${(i + k) % 6}` });
  }
  const lib: Library = {
    works, characters,
    people: Array.from({ length: 6 }, (_, i) => ({ id: `va${i}`, name: `Voice Actor ${i}`, aliases: [] })),
    themes: works.slice(0, 10).flatMap((w, i) => [
      { id: `t${i}op`, workId: w.id, type: "OP" as const, seq: 1, song: `Song Open ${i}`, artists: [`Band ${i}`], audioUrl: `https://a.test/${i}.ogg` },
      { id: `t${i}ed`, workId: w.id, type: "ED" as const, seq: 1, song: `Song End ${i}`, artists: [`Singer ${i}`], audioUrl: `https://a.test/${i}e.ogg` },
    ]),
    media: [{ id: "frame:x:0", workId: "anilist:3", kind: "frame", src: "frames/x-0.jpg" }],
  };
  return indexLibrary(lib);
}
