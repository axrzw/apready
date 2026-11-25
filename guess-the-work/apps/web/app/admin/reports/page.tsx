import { getRepo } from "@/lib/server/repo";
import ReportButtons from "@/components/ReportButtons";

export default async function Reports() {
  const repo = getRepo();
  const [reports, users] = await Promise.all([repo.listReports(), repo.listUsers()]);
  const works = new Map(await Promise.all([...new Set(reports.map((r) => r.workId).filter((x): x is string => !!x))].map(async (id) => [id, await repo.getWork(id)] as const)));
  return (
    <div className="space-y-3">
      <h1 className="font-display text-3xl">بلاغات «سؤال خربان»</h1>
      {!reports.length && <p className="panel p-4 text-muted">ما فيه بلاغات.</p>}
      {reports.map((r) => {
        const w = r.workId ? works.get(r.workId) : undefined;
        return (
          <div key={r.id} className={`panel p-4 flex flex-wrap items-center gap-3 ${r.status !== "open" ? "opacity-50" : ""}`}>
            {w?.posterUrl && <img src={w.posterUrl} alt="" className="h-16 w-11 rounded object-cover" referrerPolicy="no-referrer" />}
            <div className="flex-1 text-sm">
              <div>
                <b>{users.find((u) => u.id === r.userId)?.name ?? r.userId}</b>: {r.reason}
              </div>
              <div className="text-xs text-muted">
                {r.questionKey} · {w ? `${w.title}${w.titleAr ? ` / ${w.titleAr}` : ""}` : ""} · {new Date(r.at).toLocaleString("ar")} · {r.status}
              </div>
            </div>
            <ReportButtons id={r.id} />
          </div>
        );
      })}
    </div>
  );
}
