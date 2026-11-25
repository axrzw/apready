import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import type { PackData } from "@gtw/core/packs";
import { Avatar, Empty, PageTitle } from "@/components/ui";
import PackBuilder from "@/components/PackBuilder";
import PlayPack from "@/components/PlayPack";

export default async function Packs() {
  await requireUser();
  const repo = getRepo();
  const [packs, users] = await Promise.all([repo.listPacks(), repo.listUsers()]);
  const boards = await Promise.all(packs.map((p) => repo.leaderboard({ roomCode: `pack:${p.id}` })));
  const user = (id: string) => users.find((u) => u.id === id);
  return (
    <div className="space-y-10">
      <PageTitle kicker="PACKS" title="باقتي" />
      <section className="space-y-3">
        <h2 className="font-display text-xl">الباقات</h2>
        {!packs.length ? (
          <Empty icon="Library" title="ما فيه باقات للحين" text="ابنِ باقتك من الأعمال اللي سجّلتها، وتحدَّ فيها الشباب." />
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {packs.map((p, i) => {
              const owner = user(p.userId);
              const d = p.data as PackData;
              return (
                <li key={p.id} className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Avatar name={owner?.name ?? "?"} color={owner?.color} icon={owner?.avatar} size={24} />
                      <span className="font-display text-lg">{p.name}</span>
                    </div>
                    <div className="num text-xs text-faint">
                      {owner?.name} · {d.items.length} سؤال · {{ easy: "سهلة", normal: "عادية", hard: "صعبة" }[d.difficulty]}
                    </div>
                    {boards[i].length > 0 && (
                      <div className="num text-xs text-muted">
                        الصدارة: {boards[i].slice(0, 3).map((r) => `${r.name} ${r.points}`).join(" · ")}
                      </div>
                    )}
                  </div>
                  <PlayPack packId={p.id} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <PackBuilder />
    </div>
  );
}
