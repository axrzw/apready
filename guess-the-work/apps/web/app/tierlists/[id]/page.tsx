import { notFound } from "next/navigation";
import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { assetUrl } from "@/lib/server/media";
import type { TierArchive } from "@gtw/core/tierlist";
import { PageTitle } from "@/components/ui";
import TierArchiveView from "@/components/TierArchiveView";

export default async function TierListPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const repo = getRepo();
  const row = await repo.getSession(decodeURIComponent(id));
  if (!row || (row.summary as { kind?: string }).kind !== "tierlist") notFound();
  const t = (row.summary as { tier: TierArchive }).tier;
  const parentRow = t.parent ? await repo.getSession(t.parent) : undefined;
  const parent = parentRow ? (parentRow.summary as { tier: TierArchive }).tier : undefined;
  // images through /api/m (same origin, so the board can be saved as a picture)
  const img = (src?: string) => (src ? assetUrl({ a: { type: "plain", src } }) : undefined);
  const audio = (src?: string) => (src ? assetUrl({ a: { type: "audio", src, effect: "normal", start: 0, duration: 30 } }) : undefined);
  const items = t.items.map((it) => ({ ...it, image: img(it.image), audio: audio(it.audio) }));
  return (
    <div className="space-y-6">
      <PageTitle kicker="TIER LIST" title={new Date(row.at).toLocaleDateString("ar-SA-u-nu-latn", { day: "numeric", month: "long", year: "numeric" })} />
      <TierArchiveView id={row.id} t={{ ...t, items }} parent={parent ? { board: parent.board, at: parentRow!.at } : undefined} />
    </div>
  );
}
