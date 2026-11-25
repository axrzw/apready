export type Lang = "ar" | "en";

export const dict = {
  appName: { ar: "خمّن العمل", en: "Guess the Work" },
  tagline: { ar: "تحديات أنمي وألعاب ومسلسلات وأفلام… بيننا وبس", en: "Anime, games, series & film challenges — just us" },
  solo: { ar: "لعب فردي", en: "Solo" },
  createRoom: { ar: "أنشئ غرفة", en: "Create a room" },
  join: { ar: "ادخل غرفة", en: "Join a room" },
  code: { ar: "رمز الغرفة", en: "Room code" },
  daily: { ar: "التحدي اليومي", en: "Daily challenge" },
  leaderboard: { ar: "لوحة الصدارة", en: "Leaderboard" },
  stats: { ar: "إحصائياتي", en: "My stats" },
  gallery: { ar: "معرض الرسمات", en: "Drawings gallery" },
  admin: { ar: "الأدمن", en: "Admin" },
  logout: { ar: "خروج", en: "Log out" },
  start: { ar: "ابدأ", en: "Start" },
  answer: { ar: "جاوب", en: "Answer" },
  typeAnswer: { ar: "اكتب اسم العمل (عربي أو إنجليزي)…", en: "Type the name (Arabic or English)…" },
  hint: { ar: "تلميح", en: "Hint" },
  skip: { ar: "تخطي", en: "Skip" },
  next: { ar: "التالي", en: "Next" },
  correct: { ar: "صح!", en: "Correct!" },
  wrong: { ar: "غلط", en: "Wrong" },
  partial: { ar: "قريب! نص النقاط", en: "Close! Partial points" },
  players: { ar: "اللاعبين", en: "Players" },
  settings: { ar: "الإعدادات", en: "Settings" },
  finished: { ar: "انتهت!", en: "Finished!" },
  playAgain: { ar: "العب مرة ثانية", en: "Play again" },
  report: { ar: "سؤال خربان", en: "Broken question" },
  chooseFour: { ar: "اختيار من ٤ (نقاط أقل)", en: "Pick from 4 (fewer points)" },
  acceptMine: { ar: "اعتمد جوابي", en: "Accept my answer" },
  waitingHost: { ar: "ننتظر المضيف يبدأ…", en: "Waiting for the host…" },
} as const;

export type Key = keyof typeof dict;

export function t(lang: Lang, key: Key): string {
  return dict[key][lang];
}
