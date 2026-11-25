import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { assetUrl } from "@/lib/server/media";

export default async function Gallery() {
  await requireUser();
  const repo = getRepo();
  const [drawings, users] = await Promise.all([repo.listDrawings(), repo.listUsers()]);
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? "؟";
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">🖼️ معرض الرسمات</h1>
      {!drawings.length && <p className="card text-zinc-400">ما فيه رسمات للحين. العبوا طور الرسّام!</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {drawings.map((d) => {
          const url = assetUrl({ asset: { type: "plain", src: d.png } });
          return (
            <div key={d.id} className="card space-y-2">
              <img src={url} alt="" className="h-52 w-full rounded-lg bg-white object-contain" />
              <div className="flex items-center justify-between text-sm">
                <span>
                  <b>{name(d.userId)}</b> · {d.subject}
                </span>
                <a className="chip" href={url} download={`drawing-${d.id}.png`}>
                  ⬇ PNG
                </a>
              </div>
              <div className="text-xs text-zinc-500">
                🏆 {d.votesBest} · 😂 {d.votesFunny} · {new Date(d.at).toLocaleDateString("ar")}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
