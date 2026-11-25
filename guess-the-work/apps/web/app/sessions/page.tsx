import Link from "next/link";
import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { Icon } from "@/lib/icons";
import { Empty, PageTitle } from "@/components/ui";
import type { SessionSummary } from "@gtw/core/summary";

export default async function Sessions() {
  await requireUser();
  // tier lists have their own archive («تير ليستاتنا»)
  const list = (await getRepo().listSessions(80)).filter((x) => (x.summary as { kind?: string }).kind !== "tierlist").slice(0, 60);
  return (
    <div>
      <PageTitle kicker="ARCHIVE" title="أرشيف السهرات">
        <Link href="/tierlists" className="toggle h-8">
          <Icon name="Rows3" size={14} /> تير ليستاتنا
        </Link>
        <Link href="/h2h" className="toggle h-8">
          <Icon name="Swords" size={14} /> المواجهات
        </Link>
      </PageTitle>
      {!list.length ? (
        <Empty icon="Clapperboard" title="ما فيه سهرات محفوظة" text="كل جولة تخلص ينحفظ ملخصها هنا." />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {list.map((x) => {
            const s = x.summary as SessionSummary & { kind?: string };
            return (
              <li key={x.id}>
                <Link href={`/sessions/${encodeURIComponent(x.id)}`} className="flex items-center gap-4 py-3 hover:bg-surface/60">
                  <span className="num w-24 text-xs text-faint">{new Date(x.at).toLocaleDateString("en-GB")}</span>
                  <span className="flex-1">
                    <span className="block">{s.ranking.map((r) => r.name).join("، ")}</span>
                    <span className="num block text-xs text-muted">
                      الأول: {s.ranking[0]?.name} ({s.ranking[0]?.score}) · {s.questions} سؤال
                    </span>
                  </span>
                  <Icon name="ArrowLeft" className="text-faint ltr:rotate-180" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
