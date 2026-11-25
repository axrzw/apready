import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { MODES } from "@gtw/core/questions";
import { CATEGORY_AR } from "@gtw/core/i18n";
import type { Category } from "@gtw/core/types";

export default async function Stats({ searchParams }: { searchParams: Promise<{ u?: string }> }) {
  const s = await requireUser();
  const { u } = await searchParams;
  const repo = getRepo();
  const users = await repo.listUsers();
  const uid = u && users.some((x) => x.id === u) ? u : s.uid;
  const st = await repo.playerStats(uid);
  const rate = (r: { correct: number; answers: number }) => (r.answers ? r.correct / r.answers : 0);
  const cats = [...st.byCategory].sort((a, b) => rate(b) - rate(a));
  const modes = st.byMode.filter((m) => m.answers >= 3).sort((a, b) => rate(a) - rate(b));
  const all = await Promise.all(users.map(async (x) => ({ u: x, st: await repo.playerStats(x.id) })));
  const bestDescriber = [...all].sort((a, b) => b.st.describerPoints - a.st.describerPoints)[0];
  const bestDrawer = [...all].sort((a, b) => b.st.drawerPoints - a.st.drawerPoints)[0];
  const modeName = (id: string) => MODES.find((m) => m.id === id)?.ar ?? (id === "describer" ? "الواصف" : id === "drawer" ? "الرسّام" : id);
  const tile = (label: string, value: string, sub?: string) => (
    <div className="card">
      <div className="text-sm text-zinc-400">{label}</div>
      <div className="text-2xl font-black text-brand-300">{value}</div>
      {sub && <div className="text-sm text-zinc-500">{sub}</div>}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-black">📊 الإحصائيات</h1>
        {users.map((x) => (
          <a key={x.id} href={`/stats?u=${encodeURIComponent(x.id)}`} className={`chip ${x.id === uid ? "chip-on" : ""}`}>
            {x.name}
          </a>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tile("مجموع النقاط", st.totalPoints.toLocaleString())}
        {tile("نسبة الصح", `${Math.round(st.accuracy * 100)}%`)}
        {tile("أقوى قسم", cats[0] ? CATEGORY_AR[cats[0].category as Category] ?? cats[0].category : "—", cats[0] ? `${Math.round(rate(cats[0]) * 100)}%` : undefined)}
        {tile("أضعف طور", modes[0] ? modeName(modes[0].mode) : "—", modes[0] ? `${Math.round(rate(modes[0]) * 100)}%` : "يبي ٣ أسئلة على الأقل")}
        {tile("أعمال مظلومة عرفتها", String(st.hiddenGemsKnown))}
        {tile("أعمال مغمورة عرفتها", String(st.obscureKnown))}
        {tile("أفضل واصف", bestDescriber?.st.describerPoints ? bestDescriber.u.name : "—", bestDescriber?.st.describerPoints ? `${bestDescriber.st.describerPoints} نقطة` : undefined)}
        {tile("أفضل رسّام", bestDrawer?.st.drawerPoints ? bestDrawer.u.name : "—", bestDrawer?.st.drawerPoints ? `${bestDrawer.st.drawerPoints} نقطة` : undefined)}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="mb-2 font-bold">حسب الطور</h2>
          {st.byMode.map((m) => (
            <Bar key={m.mode} label={modeName(m.mode)} value={rate(m)} n={m.answers} />
          ))}
        </div>
        <div className="card">
          <h2 className="mb-2 font-bold">حسب القسم</h2>
          {st.byCategory.map((m) => (
            <Bar key={m.category} label={CATEGORY_AR[m.category as Category] ?? m.category} value={rate(m)} n={m.answers} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Bar({ label, value, n }: { label: string; value: number; n: number }) {
  return (
    <div className="mb-2">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-zinc-400">
          {Math.round(value * 100)}% · {n}
        </span>
      </div>
      <div className="h-2 rounded-full bg-ink-700">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}
