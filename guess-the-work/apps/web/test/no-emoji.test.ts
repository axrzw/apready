import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Design rule (docs/DESIGN.md): no emoji or pictographic symbols anywhere in the UI or its texts.
 * Icons come from lucide-react only. This test fails as soon as one sneaks in.
 */
const ROOT = join(__dirname, "..", "..", "..");
const SCAN = ["apps/web/app", "apps/web/components", "apps/web/lib", "packages/core/src", "packages/ingest/src", "packages/ingest/data"];
const BANNED = new RegExp(
  [
    "\\p{Extended_Pictographic}",
    "\\p{Emoji_Presentation}",
    "[\\u{FE0F}\\u{200D}\\u{20E3}]", // emoji variation selector, joiner, keycap
    "[\\u{2190}-\\u{21FF}]", // arrows used as icons
    "[\\u{2300}-\\u{23FF}]", // misc technical (⏭ ⏳ ⌨)
    "[\\u{25A0}-\\u{25FF}]", // geometric shapes (▲ ▶ ●)
    "[\\u{2600}-\\u{27BF}]", // misc symbols + dingbats (★ ✓ ✔ ✨ ✕)
    "[\\u{2B00}-\\u{2BFF}]", // arrows / stars (⬆ ⭐)
    "[\\u{1F000}-\\u{1FAFF}]",
  ].join("|"),
  "u",
);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(tsx?|json|css|md)$/.test(f)) out.push(p);
  }
  return out;
}

describe("no emoji in the UI and its texts", () => {
  it("the pattern catches the usual suspects", () => {
    for (const c of ["✨", "✓", "★", "🎯", "✅", "⏭", "▶", "⬆️", "🙋"]) expect(BANNED.test(c), c).toBe(true);
    for (const c of ["خمّن", "A-Z", "100%", "·", "—", "«»"]) expect(BANNED.test(c), c).toBe(false);
  });
  it("source files are clean", () => {
    const bad: string[] = [];
    for (const d of SCAN)
      for (const f of files(join(ROOT, d))) {
        readFileSync(f, "utf8")
          .split("\n")
          .forEach((line, i) => {
            const m = line.match(BANNED);
            if (m) bad.push(`${relative(ROOT, f)}:${i + 1} ${JSON.stringify(m[0])}`);
          });
      }
    expect(bad).toEqual([]);
  });
});
