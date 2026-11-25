import Link from "next/link";
import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { getLibrary } from "@/lib/server/library";
import { assetUrl } from "@/lib/server/media";
import { providersSA } from "@/lib/server/providers";
import { Empty, PageTitle } from "@/components/ui";
import WishButton from "@/components/WishButton";

export default async function Mine() {
  const s = await requireUser();
  const [ids, lib] = await Promise.all([getRepo().wishesOf(s.uid), getLibrary()]);
  const works = ids.map((id) => lib.work.get(id)).filter((w): w is NonNullable<typeof w> => !!w);
  const providers = await Promise.all(works.map((w) => providersSA(w)));
  return (
    <div>
      <PageTitle kicker="WATCHLIST" title="قائمتي" />
      {!works.length ? (
        <Empty icon="Star" title="القائمة فاضية" text="بعد كل سؤال اضغط «أبي أشوفه» على أي عمل عجبك." action={<Link className="btn-primary" href="/discover">اكتشف</Link>} />
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {works.map((w, i) => (
            <li key={w.id} className="space-y-2">
              {w.posterUrl && <img src={assetUrl({ a: { type: "plain", src: w.posterUrl } })} alt="" className="aspect-[2/3] w-full rounded-md border border-line object-cover" />}
              <div className="text-sm leading-tight" data-bidi>
                {w.titleAr || w.title}
              </div>
              <div className="text-xs text-faint">{providers[i].length ? `في السعودية: ${providers[i].join("، ")}` : process.env.TMDB_API_KEY ? "ما لقينا منصة في السعودية" : ""}</div>
              <WishButton workId={w.id} on />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
