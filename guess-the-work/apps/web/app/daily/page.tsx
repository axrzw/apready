import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { getLibrary } from "@/lib/server/library";
import { createAndStart, roomExists } from "@/lib/server/rooms";
import { availableModes } from "@gtw/core/generate";
import { createHash } from "node:crypto";
import { Empty, PageTitle } from "@/components/ui";
import LeaderTable from "@/components/LeaderTable";

/** Same 10 questions for everybody today (seeded by the date, Riyadh time). One try each. */
export default async function Daily() {
  const s = await requireUser();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  const tag = `daily:${date}`;
  const code = `D${createHash("sha1").update(`${date}|${s.uid}`).digest("hex").slice(0, 8).toUpperCase()}`;
  if (await roomExists(code)) redirect(`/room/${code}`);
  const board = await getRepo().leaderboard({ roomCode: tag });
  const users = await getRepo().listUsers();
  const played = board.find((r) => r.userId === s.uid);
  if (!played) {
    const lib = await getLibrary();
    const modes = availableModes(lib).filter((m) => !["higher_lower", "timeline"].includes(m));
    if (modes.length) {
      await createAndStart(s, { kind: "guess", modes, count: 10, method: "both", timeLimitSec: 30, adaptive: false }, tag, code);
      redirect(`/room/${code}`);
    }
  }
  return (
    <div className="mx-auto max-w-xl">
      <PageTitle kicker={`DAILY · ${date}`} title="التحدي اليومي" />
      {played ? (
        <p className="mb-6 text-muted">
          لعبته اليوم: <span className="num text-accent">{played.points}</span> نقطة ({played.correct} من {played.answers}). ارجع بكرة.
        </p>
      ) : (
        <Empty icon="Library" title="ما فيه أسئلة" text="المكتبة فاضية. شغّل السحب من الأدمن." />
      )}
      <h2 className="mb-2 mt-8 font-display text-lg">ترتيب اليوم</h2>
      {board.length ? <LeaderTable rows={board.map((r) => ({ ...r, color: users.find((u) => u.id === r.userId)?.color, avatar: users.find((u) => u.id === r.userId)?.avatar }))} /> : <p className="text-sm text-faint">ما أحد لعب اليوم.</p>}
      <Link href="/" className="btn-ghost mt-8">
        الرئيسية
      </Link>
    </div>
  );
}
