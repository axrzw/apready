import Link from "next/link";
import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { MODES } from "@gtw/core/questions";
import { CATEGORY_AR } from "@gtw/core/i18n";
import type { Category } from "@gtw/core/types";
import { Avatar, PageTitle } from "@/components/ui";

export default async function Stats({ searchParams }: { searchParams: Promise<{ u?: string }> }) {
  const s = await requireUser();
  const { u } = await searchParams;
  const repo = getRepo();
  const users = await repo.listUsers();
  const uid = u && users.some((x) => x.id === u) ? u : s.uid;
  const me = users.find((x) => x.id === uid);
  const all = await Promise.all(users.map(async (x) => ({ u: x, st: await repo.playerStats(x.id) })));
  const st = all.find((x) => x.u.id === uid)?.st ?? (await repo.playerStats(uid));
  const rate = (r: { correct: number; answers: number }) => (r.answers ? r.correct / r.answers : 0);
  const cats = [...st.byCategory].sort((a, b) => rate(b) - rate(a));
  const modes = st.byMode.filter((m) => m.answers >= 3).sort((a, b) => rate(a) - rate(b));
  const bestDescriber = [...all].sort((a, b) => b.st.describerPoints - a.st.describerPoints)[0];
  const bestDrawer = [...all].sort((a, b) => b.st.drawerPoints - a.st.drawerPoints)[0];
  const modeName = (id: string) => MODES.find((m) => m.id === id)?.ar ?? (id === "describer" ? "الواصف" : id === "drawer" ? "الرسّام" : id);
  const tiles: [string, string, string?][] = [
    ["مجموع النقاط", st.totalPoints.toLocaleString("en-US")],
    ["نسبة الصح", `${Math.round(st.accuracy * 100)}%`],
    ["أقوى قسم", cats[0] ? (CATEGORY_AR[cats[0].category as Category] ?? cats[0].category) : "—", cats[0] ? `${Math.round(rate(cats[0]) * 100)}%` : undefined],
    ["أضعف طور", modes[0] ? modeName(modes[0].mode) : "—", modes[0] ? `${Math.round(rate(modes[0]) * 100)}%` : "يبي ٣ أسئلة على الأقل"],
    ["أعمال مظلومة عرفها", String(st.hiddenGemsKnown)],
    ["أعمال مغمورة عرفها", String(st.obscureKnown)],
    ["أفضل واصف", bestDescriber?.st.describerPoints ? bestDescriber.u.name : "—", bestDescriber?.st.describerPoints ? `${bestDescriber.st.describerPoints} نقطة` : undefined],
    ["أفضل رسّام", bestDrawer?.st.drawerPoints ? bestDrawer.u.name : "—", bestDrawer?.st.drawerPoints ? `${bestDrawer.st.drawerPoints} نقطة` : undefined],
  ];
  return (
    <div>
      <PageTitle kicker="PLAYER FILE" title={me?.name ?? "الإحصائيات"} />
      <div className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4">
        {users.map((x) => (
          <Link key={x.id} href={`/stats?u=${encodeURIComponent(x.id)}`} className={`toggle shrink-0 ${x.id === uid ? "toggle-on" : ""}`}>
            <Avatar name={x.name} color={x.color} icon={x.avatar} size={20} />
            {x.name}
          </Link>
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-4">
        {tiles.map(([label, value, sub]) => (
          <div key={label} className="bg-surface p-4">
            <dt className="label">{label}</dt>
            <dd className="mt-2 font-display text-2xl">{value}</dd>
            {sub && <dd className="num mt-1 text-xs text-faint">{sub}</dd>}
          </div>
        ))}
      </dl>
      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <Bars title="حسب الطور" rows={st.byMode.map((m) => ({ label: modeName(m.mode), v: rate(m), n: m.answers }))} />
        <Bars title="حسب القسم" rows={st.byCategory.map((m) => ({ label: CATEGORY_AR[m.category as Category] ?? m.category, v: rate(m), n: m.answers }))} />
      </div>
    </div>
  );
}

function Bars({ title, rows }: { title: string; rows: { label: string; v: number; n: number }[] }) {
  return (
    <section>
      <h2 className="mb-3 font-display text-lg">{title}</h2>
      {!rows.length && <p className="text-sm text-faint">ما فيه بيانات للحين.</p>}
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex justify-between text-sm">
              <span>{r.label}</span>
              <span className="num text-faint">
                {Math.round(r.v * 100)}% · {r.n}
              </span>
            </div>
            <div className="mt-1 h-[3px] rounded-full bg-line">
              <div className="h-full rounded-full bg-accent" style={{ width: `${r.v * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
