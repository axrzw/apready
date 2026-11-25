import { notFound } from "next/navigation";
import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { getLibrary } from "@/lib/server/library";
import { assetUrl } from "@/lib/server/media";
import type { SessionSummary } from "@gtw/core/summary";
import { PageTitle } from "@/components/ui";
import ShareCard, { type CardData } from "@/components/ShareCard";

const TIER_AR = { mainstream: "مشهور", mid: "متوسط", hidden_gem: "مظلوم", obscure: "مغمور" } as const;

export default async function Session({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const repo = getRepo();
  const row = await repo.getSession(decodeURIComponent(id));
  if (!row) notFound();
  const s = row.summary as SessionSummary;
  const lib = await getLibrary();
  const name = (uid?: string) => s.ranking.find((r) => r.userId === uid)?.name ?? "؟";
  const work = (wid?: string) => (wid ? lib.work.get(wid) : undefined);
  const drawing = async (d?: { id: string }) => (d ? (await repo.getDrawing(d.id))?.png : undefined);
  const [best, funny] = await Promise.all([drawing(s.bestDrawing), drawing(s.funniestDrawing)]);
  const highlights: { label: string; value: string; sub?: string }[] = [];
  if (s.fastest) highlights.push({ label: "أسرع إجابة", value: name(s.fastest.userId), sub: `${(s.fastest.ms / 1000).toFixed(1)} ث · ${work(s.fastest.workId)?.titleAr ?? work(s.fastest.workId)?.title ?? ""}` });
  if (s.hardest) highlights.push({ label: "أصعب سؤال انحل", value: work(s.hardest.workId)?.titleAr ?? work(s.hardest.workId)?.title ?? "؟", sub: `${TIER_AR[s.hardest.tier]} · حلّه ${s.hardest.solvedBy.map(name).join("، ")}` });
  if (s.weirdest) highlights.push({ label: "أغرب عمل محد عرفه", value: work(s.weirdest.workId)?.titleAr ?? work(s.weirdest.workId)?.title ?? "؟", sub: TIER_AR[s.weirdest.tier] });
  if (s.mostHints) highlights.push({ label: "أكثر واحد استخدم تلميحات", value: name(s.mostHints.userId), sub: `${s.mostHints.count} تلميح` });
  if (s.bestDrawing) highlights.push({ label: "أفضل رسمة", value: name(s.bestDrawing.userId), sub: `${s.bestDrawing.votes} صوت` });
  if (s.funniestDrawing) highlights.push({ label: "أغبى رسمة", value: name(s.funniestDrawing.userId), sub: `${s.funniestDrawing.votes} صوت` });
  const card: CardData = {
    date: new Date(row.at).toLocaleDateString("en-GB"),
    ranking: s.ranking.map((r) => ({ name: r.name, score: r.score, color: r.color ?? "#9c978e" })),
    highlights,
    images: [best, funny].filter((x): x is string => !!x).map((src) => assetUrl({ a: { type: "plain", src } })),
  };
  return (
    <div className="space-y-8">
      <PageTitle kicker={`SESSION · ${card.date}`} title="ملخص السهرة" />
      <ShareCard data={card} />
      <dl className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2">
        {highlights.map((h) => (
          <div key={h.label} className="bg-surface p-4">
            <dt className="label">{h.label}</dt>
            <dd className="mt-1 font-display text-xl" data-bidi>
              {h.value}
            </dd>
            {h.sub && <dd className="num text-xs text-muted">{h.sub}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}
