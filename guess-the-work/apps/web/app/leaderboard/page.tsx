import Link from "next/link";
import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { getLang } from "@/lib/server/lang";
import { MODES } from "@gtw/core/questions";
import { Icon } from "@/lib/icons";
import { Empty, PageTitle } from "@/components/ui";
import LeaderTable from "@/components/LeaderTable";

export default async function Leaderboard({ searchParams }: { searchParams: Promise<{ mode?: string; range?: string }> }) {
  await requireUser();
  const lang = await getLang();
  const { mode, range } = await searchParams;
  const since = range === "week" ? Date.now() - 7 * 86_400_000 : range === "month" ? Date.now() - 30 * 86_400_000 : undefined;
  const repo = getRepo();
  const [rows, users, titles] = await Promise.all([repo.leaderboard({ mode, since }), repo.listUsers(), repo.getSetting<Record<string, string[]>>("titles")]);
  const tabs = [{ id: "", ar: "المجموع", en: "Overall", icon: "Trophy" }, ...MODES, { id: "describer", ar: "الواصف", en: "Describer", icon: "Mic" }, { id: "drawer", ar: "الرسّام", en: "Drawer", icon: "Pen" }];
  const ranges = [
    ["", "كل الوقت"],
    ["month", "الشهر"],
    ["week", "الأسبوع"],
  ];
  return (
    <div>
      <PageTitle kicker="LEADERBOARD" title="لوحة الصدارة">
        <div className="flex gap-1">
          {ranges.map(([r, l]) => (
            <Link key={r} href={`/leaderboard?mode=${mode ?? ""}&range=${r}`} className={`toggle h-8 ${(range ?? "") === r ? "toggle-on" : ""}`}>
              {l}
            </Link>
          ))}
        </div>
      </PageTitle>
      <div className="-mx-4 mb-6 flex gap-1 overflow-x-auto px-4 pb-1">
        {tabs.map((m) => (
          <Link key={m.id} href={`/leaderboard?mode=${m.id}${range ? `&range=${range}` : ""}`} className={`toggle h-8 shrink-0 ${(mode ?? "") === m.id ? "toggle-on" : ""}`}>
            <Icon name={m.icon} size={14} />
            {lang === "ar" ? m.ar : m.en}
          </Link>
        ))}
      </div>
      {rows.length ? (
        <LeaderTable rows={rows.map((r) => ({ ...r, color: users.find((u) => u.id === r.userId)?.color, avatar: users.find((u) => u.id === r.userId)?.avatar, title: titles?.[r.userId]?.join(" · ") }))} />
      ) : (
        <Empty icon="Trophy" title="ما أحد لعب للحين" text="أول جولة تملأ اللوحة." action={<Link href="/play" className="btn-primary">العب الحين</Link>} />
      )}
    </div>
  );
}
