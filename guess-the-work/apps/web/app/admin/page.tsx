import { getRepo } from "@/lib/server/repo";
import { jobNames, runningJobs, hasYtDlp } from "@/lib/server/admin";
import { CATEGORY_AR, TIER_AR } from "@gtw/core/i18n";
import { CATEGORIES, DEFAULT_TIER_MIX, TIERS, type Category, type Tier, type TierMix } from "@gtw/core/types";
import AdminActions from "@/components/AdminActions";
import { PageTitle } from "@/components/ui";
import { Icon } from "@/lib/icons";

const JOB_AR: Record<string, string> = {
  weekly: "المهمة الأسبوعية (الموسم الجديد + عينة مظلومة/مغمورة + قوائم الشباب + فحص الروابط)",
  seed_small: "سحب صغير",
  seed_big: "سحب كبير (~5000 عمل)",
  media: "أغاني AnimeThemes + قص الصوت واللقطات (100)",
  ocr: "OCR: اكتشاف النص على البوسترات (1000) عشان ينحجب",
  keyed: "TMDB + IGDB (يبي مفاتيح)",
};

export default async function Admin() {
  const repo = getRepo();
  const [cov, counts, jobs, mix] = await Promise.all([repo.coverage(), repo.counts(), repo.listJobs(15), repo.getSetting<TierMix>("defaultMix")]);
  const total = cov.reduce((s, r) => s + r.count, 0) || 1;
  const byTier = Object.fromEntries(TIERS.map((t) => [t, cov.filter((r) => r.tier === t).reduce((s, r) => s + r.count, 0)])) as Record<Tier, number>;
  const byCat = Object.fromEntries(CATEGORIES.map((c) => [c, cov.filter((r) => r.category === c).reduce((s, r) => s + r.count, 0)])) as Record<Category, number>;
  const cell = (c: Category, t: Tier) => cov.filter((r) => r.category === c && r.tier === t).reduce((s, r) => s + r.count, 0);
  const decades = [...new Set(cov.map((r) => r.decade).filter((d): d is number => d !== null))].sort();
  const byDecade = decades.map((d) => ({ d, n: cov.filter((r) => r.decade === d).reduce((s, r) => s + r.count, 0) }));
  const genres = Object.entries(cov.reduce<Record<string, number>>((m, r) => (r.genre ? ((m[r.genre] = (m[r.genre] ?? 0) + r.count), m) : m), {})).sort((a, b) => b[1] - a[1]);

  const alerts: string[] = [];
  if (byTier.mainstream / total > 0.35) alerts.push(`طغيان للمشهور: ${Math.round((byTier.mainstream / total) * 100)}% من المكتبة (الهدف ≤ 35%)`);
  for (const t of TIERS) if (byTier[t] / total < 0.1) alerts.push(`نقص في طبقة «${TIER_AR[t]}»: ${byTier[t]} عمل`);
  for (const c of CATEGORIES) if (byCat[c] < 150) alerts.push(`قسم «${CATEGORY_AR[c]}» فيه ${byCat[c]} عمل بس${c === "game" || c === "movie" ? " (يبي مفاتيح IGDB/TMDB)" : ""}`);
  if (!counts.themes) alerts.push("ما فيه أوبننق/إندنق: شغّل مهمة الأغاني (AnimeThemes)");

  return (
    <div className="space-y-4">
      <PageTitle kicker="ADMIN · COVERAGE" title="تغطية المكتبة" />
      <div className="grid gap-3 sm:grid-cols-5">
        {Object.entries(counts).map(([k, v]) => (
          <div key={k} className="panel p-4">
            <div className="text-sm text-muted">{{ works: "أعمال", characters: "شخصيات", people: "مؤدين/ممثلين", themes: "أغاني", media: "لقطات/مقاطع" }[k]}</div>
            <div className="font-display text-3xl">{v.toLocaleString()}</div>
          </div>
        ))}
      </div>
      {alerts.length > 0 && (
        <div className="panel border-accent/40 p-4">
          <h2 className="mb-2 flex items-center gap-2 font-display text-lg text-accent"><Icon name="AlertTriangle" size={18} /> تنبيهات</h2>
          <ul className="list-inside list-disc text-sm">{alerts.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      <div className="panel p-4 overflow-x-auto">
        <h2 className="mb-2 font-bold">القسم × طبقة الشهرة</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted">
              <th className="text-start">القسم</th>
              {TIERS.map((t) => <th key={t}>{TIER_AR[t]}</th>)}
              <th>المجموع</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((c) => (
              <tr key={c} className="border-t border-line">
                <td className="py-1">{CATEGORY_AR[c]}</td>
                {TIERS.map((t) => <td key={t} className="text-center">{cell(c, t)}</td>)}
                <td className="text-center font-bold">{byCat[c]}</td>
              </tr>
            ))}
            <tr className="border-t border-line font-bold">
              <td>النسبة</td>
              {TIERS.map((t) => <td key={t} className="text-center">{Math.round((byTier[t] / total) * 100)}%</td>)}
              <td className="text-center">{total}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="panel p-4">
          <h2 className="mb-2 font-bold">حسب العقد</h2>
          {byDecade.map(({ d, n }) => (
            <div key={d} className="flex items-center gap-2 text-sm">
              <span className="w-12">{d}s</span>
              <div className="h-[3px] flex-1 rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${(n / Math.max(...byDecade.map((x) => x.n))) * 100}%` }} /></div>
              <span className="w-12 text-end text-muted">{n}</span>
            </div>
          ))}
        </div>
        <div className="panel p-4">
          <h2 className="mb-2 font-bold">حسب التصنيف (أول تصنيف)</h2>
          <div className="flex flex-wrap gap-1 text-sm">{genres.slice(0, 40).map(([g, n]) => <span key={g} className="toggle">{g} <b>{n}</b></span>)}</div>
        </div>
      </div>
      <AdminActions jobs={jobNames().map((n) => ({ id: n, label: JOB_AR[n] ?? n }))} running={runningJobs().map((j) => j.name)} mix={mix ?? DEFAULT_TIER_MIX} ytdlp={hasYtDlp()} />
      <div className="panel p-4">
        <h2 className="mb-2 font-bold">آخر المهام</h2>
        <ul className="space-y-1 text-xs text-muted">
          {jobs.map((j, i) => (
            <li key={i}>
              {new Date(j.at).toLocaleString("ar")} · <b className="text-zinc-200">{j.name}</b> · {j.status} {j.detail ? `· ${j.detail.slice(0, 200)}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
