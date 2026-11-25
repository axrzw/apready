import Link from "next/link";
import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { getLang } from "@/lib/server/lang";
import { MODES } from "@gtw/core/questions";

export default async function Leaderboard({ searchParams }: { searchParams: Promise<{ mode?: string; range?: string }> }) {
  await requireUser();
  const lang = await getLang();
  const { mode, range } = await searchParams;
  const since = range === "week" ? Date.now() - 7 * 86_400_000 : range === "month" ? Date.now() - 30 * 86_400_000 : undefined;
  const rows = await getRepo().leaderboard({ mode, since });
  const tabs = [{ id: "", ar: "المجموع", en: "Total" }, ...MODES, { id: "describer", ar: "الواصف", en: "Describer" }, { id: "drawer", ar: "الرسّام", en: "Drawer" }];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">🏆 لوحة الصدارة</h1>
      <div className="flex flex-wrap gap-2">
        {tabs.map((m) => (
          <Link key={m.id} href={`/leaderboard?mode=${m.id}${range ? `&range=${range}` : ""}`} className={`chip ${(mode ?? "") === m.id ? "chip-on" : ""}`}>
            {lang === "ar" ? m.ar : m.en}
          </Link>
        ))}
      </div>
      <div className="flex gap-2 text-sm">
        {[
          ["", "كل الوقت"],
          ["month", "الشهر"],
          ["week", "الأسبوع"],
        ].map(([r, l]) => (
          <Link key={r} href={`/leaderboard?mode=${mode ?? ""}&range=${r}`} className={`chip ${(range ?? "") === r ? "chip-on" : ""}`}>
            {l}
          </Link>
        ))}
      </div>
      <table className="card w-full text-start">
        <thead className="text-sm text-zinc-400">
          <tr>
            <th className="text-start">#</th>
            <th className="text-start">اللاعب</th>
            <th>النقاط</th>
            <th>الصح</th>
            <th>النسبة</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.userId} className="border-t border-ink-700">
              <td className="py-2">{["🥇", "🥈", "🥉"][i] ?? i + 1}</td>
              <td>{r.name}</td>
              <td className="text-center font-mono text-brand-300">{r.points.toLocaleString()}</td>
              <td className="text-center">{r.correct}</td>
              <td className="text-center">{r.answers ? Math.round((r.correct / r.answers) * 100) : 0}%</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-zinc-500">
                ما أحد لعب للحين
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
