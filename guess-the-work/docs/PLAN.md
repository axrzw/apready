# خمّن العمل — Implementation Plan

> For agentic workers: executed natively (superpowers:executing-plans), phase by phase, tests + build + commit after each phase.

**Goal:** A private website (Arabic RTL, English supported) where a group of friends play "guess the work" challenges (anime, games, series, films, visual novels): 18 guessing modes, Mix, and two party modes (Describer, Drawer), with a huge, tier-balanced library.

**Architecture:** pnpm monorepo. `packages/core` holds every game rule as pure TypeScript (matching, selection, hints, scoring, question builders, room state machine incl. describer/drawer roles) so a Discord bot can reuse it. `packages/db` is a swappable data layer (`Repo` interface; SQLite via `node:sqlite` now, Supabase/Postgres adapter + SQL migrations for later). `packages/ingest` pulls data from APIs (rate limit + cache + retry), computes popularity tiers, and processes media with ffmpeg/sharp. `apps/web` is Next.js App Router: server-side answer checking, server-side image effects with random tokens, rooms over a `RealtimeBus` (in-process SSE now, Supabase Realtime adapter later).

**Tech Stack:** Next.js 15, React 19, TypeScript 5.9, Tailwind 3.4 (logical properties for RTL), vitest, sharp, ffmpeg, tesseract.js, perfect-freehand, node:sqlite, @supabase/supabase-js.

**Spec:** the owner's original request (in the session; every requirement is listed per phase below and in MORNING_REPORT).

## Global Constraints
- Name: «خمّن العمل» (owner renamed it from «خمّنها»).
- Private: Discord OAuth + allowlist, `noindex` everywhere, no public pages; dev login without keys.
- Answers are checked only on the server; files are served under random tokens; effects rendered on the server; choices sent without the correct flag.
- Tier mix default 25/30/30/15 (mainstream/mid/hidden_gem/obscure), editable per room.
- One matching function is used for answers, forbidden words, plot redaction and hint checks.
- isAdult anime excluded.
- Everything must work without API keys (keyless sources used for real; keyed ones fully coded with fixtures).

## Phases (each = tests + build + commit)
1. **Monorepo, data model, matching (TDD).** pnpm workspace; `core/normalize.ts`, `core/match.ts` (`normalizeAr`, `normalizeEn`, `matchAnswer(input, entity) -> {ok, alias, distance}`, length-scaled threshold, exact-only ≤3 chars, season unification); `db` schema (works, aliases, items, characters, people, tags, themes, media, plays, scores, reports, users, rooms, drawings); SQLite repo.
2. **Anime ingest.** AniList (tiered sampling by popularity pages, isAdult=false), Kitsu expansion (Jikan blocked here), Wikidata SPARQL for Arabic labels by AniList/MAL id, manual Spacetoon dub names file, AnimeThemes client (+fixtures), `core/tiers.ts` (`computeTier`), ffmpeg helpers (`clipAudio`, `extractFrames` skipping edges/black/texty frames, `clipVideo`).
3. **Question engine.** `core/select.ts` (weighted tier distribution, diversity by year/genre/studio, no-repeat window), `core/hints.ts` (8 ordered hints, never leaking accepted names), `core/scoring.ts` (speed, difficulty, answer method, hints, streak, adaptive difficulty), solo play for poster/image/tags/opening.
4. **Effects + remaining guessing modes.** sharp effects (blur, pixelate, palette, colour shifts, edges, puzzle, tiles, zoom, spotlight, swirl, ASCII), OCR text masking, silhouette, eyes crop; modes 1–18.
5. **Rooms.** `core/room.ts` reducer, SSE bus, synchronized timer/media start time, Mix mode, daily challenge.
6. **Describer** (private item to describer, choose 1 of 2, forbidden words masked + penalty, skip, timer, reveal).
7. **Drawer** (canvas with perfect-freehand, fill, undo/redo; private items; guessing; reveal + votes; gallery + PNG).
8. **Discord OAuth + allowlist, admin** (works/aliases, clips, reports, tier ratios, coverage dashboard, run jobs), friends' list import (AniList, MAL).
9. **Games/films/series/VN/OSTs** (IGDB, TMDB with fixtures; TVmaze, VNDB real), weekly scheduled job + dead link check.
10. **Polish**, Arabic README, MORNING_REPORT.

## Review Focus
- Very short names ("K", "Ao") must not fuzzy-match each other — test in phase 1.
- Arabic input with hamza/ta marbuta/diacritics/tatweel must match — test in phase 1.
- Hints must never contain any accepted alias (e.g. studio named like the work) — test in phase 3.
- A player disconnecting mid-round must not freeze the room (timer advances on server time) — test in phase 5.
- Library smaller than requested question count must still produce a game (repeats allowed after exhaustion) — test in phase 3.

---

# المرحلة الثانية: حسب docs/SPEC.md (المرجع النهائي)

حالة كل بند: [x] تم ومختبر · [~] جزئي · [ ] باقي.

## النواة (أولوية 1)
- [x] Postgres بـ Drizzle: PGlite محلياً وفي الاختبارات، وNeon في الإنتاج، بنفس الـ migrations (`packages/db`).
- [x] تخزين خلف طبقة وحدة: مجلد محلي، أو Vercel Blob (`apps/web/lib/server/storage.ts`).
- [x] الدخول بكلمة سر القروب + اسم ولون ورمز، وكوكي سنة، ورابط دعوة يرجعك للغرفة. والأدمن: تعديل الأسماء والطرد.
- [x] seed الإنتاج: `snapshot/library.json.gz` يتستورد وقت البناء (`db:setup`) بأمان ويتكرر بدون ما يضاعف.
- [x] المطابقة، والتلميحات (تكلفة حسب الموضع)، والنقاط الجديدة (100 × الصعوبة، والسرعة، ومكافأة الترتيب، والسلسلة، و«الأول فقط»).
- [x] خط معالجة الصوت الصارم: ملف صوت فقط بدون فيديو أو بيانات وصفية، مع loudnorm، ومفحوص بـ ffprobe.
- [x] الإكمال التلقائي: فهرس المكتبة كاملة في المتصفح، ونقل حرفي عربي ولاتيني، ويرسل معرّف الكيان.
- [x] الغرف في قاعدة البيانات مع polling، وCAS على النسخة، والتحميل المسبق ثم بدء متزامن، ورجوع المنقطع، والمتفرج، وأدوات المضيف.
- [x] التصميم: DESIGN.md، واختبار يمنع الإيموجي، وخطوط Reem Kufi وIBM Plex Sans Arabic، وأيقونات Lucide، وFramer Motion، ومؤثرات صوتية.
- [x] Vercel: `vercel.json`، و`vercel-build`، وcron أسبوعي، ولوحة المصادر بدفعات تكمل من حيث وقفت.
- [x] E2E بـ 3 لاعبين (`e2e/e2e.cjs`).

## بعد النواة
- [x] طور «اشرح بالكاميرا».
- [x] سجل المشاهدة وطبقة القروب.
- [x] الإعدادات الموسعة: السنوات، ومصدر الأسئلة، و«استثنِ اللي شافه السائل»، والقوالب، و«بدون حرق».
- [x] طور «الموسم الحالي».
- [ ] صوت المشهد (يحتاج تريلرات بـ yt-dlp محلياً).
- [~] الأطوار الاجتماعية: مين شافه، خمّن تقييمه، باقتي.
- [~] التوصيات، وملخص السهرة، والألقاب، والثأر، والمواجهات.
- [~] المانهوا والمانغا (AniList MANGA)، والدراما الآسيوية (TMDB، بمفتاح).
