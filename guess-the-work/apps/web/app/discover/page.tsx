import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { getLibrary } from "@/lib/server/library";
import { assetUrl } from "@/lib/server/media";
import { closestFriends, highlyRatedUnseen, similarity } from "@gtw/core/recommend";
import { Avatar, Empty, PageTitle } from "@/components/ui";
import WishButton from "@/components/WishButton";

export default async function Discover() {
  const s = await requireUser();
  const repo = getRepo();
  const [all, users, lib] = await Promise.all([repo.watchAll(), repo.listUsers(), getLibrary()]);
  const user = (id: string) => users.find((u) => u.id === id);
  const picks = highlyRatedUnseen(all, s.uid).filter((p) => lib.work.has(p.workId)).slice(0, 12);
  const friends = closestFriends(all, s.uid);
  const best = friends[0];
  const fromBest = best ? highlyRatedUnseen(all.filter((x) => x.userId === best.userId || x.userId === s.uid), s.uid, 7).filter((p) => lib.work.has(p.workId)).slice(0, 8) : [];
  const active = users.filter((u) => !u.kicked && all.some((x) => x.userId === u.id));
  const Row = ({ list, note }: { list: { workId: string; from: string[]; rating: number }[]; note: (p: { from: string[]; rating: number }) => string }) => (
    <ul className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
      {list.map((p) => {
        const w = lib.work.get(p.workId)!;
        return (
          <li key={p.workId} className="w-36 shrink-0 space-y-2">
            {w.posterUrl && <img src={assetUrl({ a: { type: "plain", src: w.posterUrl } })} alt="" className="aspect-[2/3] w-full rounded-md border border-line object-cover" />}
            <div className="text-sm leading-tight" data-bidi>
              {w.titleAr || w.title}
            </div>
            <div className="num text-xs text-faint">{note(p)}</div>
            <WishButton workId={w.id} compact />
          </li>
        );
      })}
    </ul>
  );
  return (
    <div className="space-y-10">
      <PageTitle kicker="DISCOVER" title="اكتشف" />
      <section className="space-y-3">
        <h2 className="font-display text-xl">شافوه الشباب وعجبهم، وأنت ما شفته</h2>
        {picks.length ? <Row list={picks} note={(p) => `${p.rating}/10 · ${p.from.map((id) => user(id)?.name).join("، ")}`} /> : <Empty icon="Sparkles" title="ما فيه للحين" text="لما الشباب يقيّمون أعمال في «سجلّي» تطلع هنا." />}
      </section>
      {best && (
        <section className="space-y-3">
          <h2 className="font-display text-xl">
            توصية من {user(best.userId)?.name} <span className="num text-sm text-muted">(ذوقكم متشابه {Math.round(best.score * 100)}%)</span>
          </h2>
          {fromBest.length ? <Row list={fromBest} note={(p) => `قيّمه ${p.rating}/10`} /> : <p className="text-sm text-faint">شفت كل اللي قيّمه عالي.</p>}
        </section>
      )}
      <section className="space-y-3">
        <h2 className="font-display text-xl">تشابه الذوق</h2>
        {active.length < 2 ? (
          <p className="text-sm text-faint">يبي لاعبين على الأقل مقيّمين ٣ أعمال مشتركة.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th />
                  {active.map((u) => (
                    <th key={u.id} className="px-2 pb-2">
                      <Avatar name={u.name} color={u.color} icon={u.avatar} size={24} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {active.map((a) => (
                  <tr key={a.id}>
                    <td className="pe-3 text-muted">{a.name}</td>
                    {active.map((b) => {
                      const sim = a.id === b.id ? null : similarity(all.filter((x) => x.userId === a.id), all.filter((x) => x.userId === b.id));
                      return (
                        <td key={b.id} className="num px-2 py-1 text-center" style={sim ? { background: `rgba(233,180,76,${sim.score * 0.35})` } : undefined}>
                          {a.id === b.id ? "—" : sim ? `${Math.round(sim.score * 100)}%` : "·"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
