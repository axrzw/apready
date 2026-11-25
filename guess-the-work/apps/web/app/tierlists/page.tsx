import Link from "next/link";
import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { Icon } from "@/lib/icons";
import { Empty, PageTitle } from "@/components/ui";
import type { TierArchive } from "@gtw/core/tierlist";

const STYLE_AR = { vote: "تصويت سري", discuss: "نقاش حر", solo: "كل واحد لوحته", guess_friend: "خمّن تير صاحبك" } as const;
const TOPIC_AR: Record<string, string> = { anime: "أنمي", series: "مسلسلات", movie: "أفلام", game: "ألعاب", character: "شخصيات", opening: "أوبننقات", ending: "إندنقات", ost: "أوستات", custom: "فلاتر خاصة" };

/** «تير ليستاتنا»: every tier list we played. */
export default async function TierLists() {
  await requireUser();
  const list = (await getRepo().listSessions(200)).filter((x) => (x.summary as { kind?: string }).kind === "tierlist");
  return (
    <div>
      <PageTitle kicker="TIER LISTS" title="تير ليستاتنا" />
      {!list.length ? (
        <Empty icon="Rows3" title="ما فيه تير ليست محفوظة" text="أي جولة «تير ليست» تخلص تنحفظ هنا مع كل اللوحات." />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {list.map((x) => {
            const t = (x.summary as { tier: TierArchive }).tier;
            return (
              <li key={x.id}>
                <Link href={`/tierlists/${encodeURIComponent(x.id)}`} className="flex items-center gap-4 py-3 hover:bg-surface/60">
                  <span className="num w-24 text-xs text-faint">{new Date(x.at).toLocaleDateString("en-GB")}</span>
                  <span className="flex-1">
                    <span className="block">
                      {TOPIC_AR[t.topic.type] ?? "تير ليست"} · {STYLE_AR[t.style]}
                      {t.parent ? <span className="ms-2 text-xs text-accent">إعادة</span> : null}
                    </span>
                    <span className="num block text-xs text-muted">
                      {t.items.length} عنصر · {t.players.map((p) => p.name).join("، ")}
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
