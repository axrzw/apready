import Link from "next/link";
import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { assetUrl } from "@/lib/server/media";
import { Icon } from "@/lib/icons";
import { Empty, PageTitle } from "@/components/ui";

export default async function Gallery() {
  await requireUser();
  const repo = getRepo();
  const [drawings, users] = await Promise.all([repo.listDrawings(), repo.listUsers()]);
  const user = (id: string) => users.find((u) => u.id === id);
  return (
    <div>
      <PageTitle kicker="EXHIBITION" title="معرض الرسمات" />
      {!drawings.length ? (
        <Empty icon="Palette" title="المعرض فاضي" text="العبوا طور الرسّام وتنحفظ الرسمات هنا." action={<Link href="/play?room=1" className="btn-primary">أنشئ غرفة</Link>} />
      ) : (
        <div className="columns-2 gap-4 sm:columns-3 lg:columns-4">
          {drawings.map((d) => {
            const url = assetUrl({ a: { type: "plain", src: d.png } });
            return (
              <figure key={d.id} className="mb-4 break-inside-avoid space-y-2">
                <img src={url} alt="" className="paper w-full rounded-sm p-1" />
                <figcaption className="flex items-start justify-between gap-2 text-sm">
                  <span>
                    <span style={{ color: user(d.userId)?.color }}>{user(d.userId)?.name ?? "؟"}</span>
                    <span className="block text-xs text-muted">{d.subject}</span>
                  </span>
                  <a className="text-faint hover:text-text" href={url} download={`drawing-${d.id}.png`} aria-label="download">
                    <Icon name="Download" size={16} />
                  </a>
                </figcaption>
                <div className="num flex gap-3 text-xs text-faint">
                  <span className="flex items-center gap-1"><Icon name="Trophy" size={12} /> {d.votesBest}</span>
                  <span className="flex items-center gap-1"><Icon name="Sparkles" size={12} /> {d.votesFunny}</span>
                </div>
              </figure>
            );
          })}
        </div>
      )}
    </div>
  );
}
