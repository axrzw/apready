import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { getLibrary } from "@/lib/server/library";
import { getLive, newRoom, startRoom } from "@/lib/server/rooms";
import { availableModes } from "@gtw/core/generate";
import { createHash } from "node:crypto";

/** Same 10 questions for everybody today (seeded by the date, Riyadh time). One try each. */
export default async function Daily() {
  const s = await requireUser();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  const tag = `daily:${date}`;
  const code = `D${createHash("sha1").update(`${date}|${s.uid}`).digest("hex").slice(0, 8).toUpperCase()}`;
  if (getLive(code)) redirect(`/room/${code}`);
  const board = await getRepo().leaderboard({ roomCode: tag });
  const played = board.find((r) => r.userId === s.uid);
  if (!played) {
    const lib = await getLibrary();
    const modes = availableModes(lib).filter((m) => !["higher_lower", "timeline"].includes(m));
    if (modes.length) {
      newRoom(s, { kind: "guess", modes, count: 10, method: "both", timeLimitSec: 30, adaptive: false }, tag, code);
      await startRoom(code, s.uid);
      redirect(`/room/${code}`);
    }
  }
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-black">التحدي اليومي · {date}</h1>
      {played ? <p className="card">لعبته اليوم: {played.points} نقطة ({played.correct}/{played.answers}). ارجع بكرة!</p> : <p className="card">ما فيه أسئلة في المكتبة. شغّل السحب من الأدمن.</p>}
      <div className="card">
        <h2 className="mb-2 font-bold">ترتيب اليوم</h2>
        <ol className="space-y-1">
          {board.map((r, i) => (
            <li key={r.userId} className="flex justify-between">
              <span>
                {i + 1}. {r.name}
              </span>
              <span className="font-mono text-brand-300">{r.points}</span>
            </li>
          ))}
        </ol>
      </div>
      <Link href="/" className="btn-ghost">
        الرئيسية
      </Link>
    </div>
  );
}
