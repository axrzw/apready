# العوائق (Blockers)

## 1. AnimeThemes.moe محجوب من بيئة البناء (503)
- `api.animethemes.moe` يرجّع 503 (صفحة حماية) من السيرفر اللي اشتغلت عليه، و Jikan (api.jikan.moe) ينقطع الاتصال فيه.
- الكود كامل: `packages/ingest/src/sources/animethemes.ts` + `jikan.ts` مع fixtures واختبارات، والـ seed يحاول ويكمّل لو فشل.
- النتيجة: أطوار الأوبننق/الإندنق/الأغنية/الصوت المعدّل/مقاطع المشاهد ما فيها مادة في قاعدة البيانات اللي على السيرفر. على جهازك شغّل:
  `pnpm seed -- --anime 0 --tvmaze 0 --vndb 0 --themes --media 300`
  (يسحب الأغاني لكل الأنمي الموجود ويقص الصوت واللقطات والمقاطع بـ ffmpeg).
- بديل Jikan للتوسيع: Kitsu (شغّال) + Wikidata.
