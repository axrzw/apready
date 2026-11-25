import { requireUser } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { Avatar, PageTitle } from "@/components/ui";

/** Head-to-head: for every question two players both answered, who scored more. */
export default async function H2H() {
  await requireUser();
  const repo = getRepo();
  const users = (await repo.listUsers()).filter((u) => !u.kicked);
  const sessions = await repo.listSessions(200);
  const rooms = [...new Set(sessions.map((s) => s.roomCode))];
  const rows = (await Promise.all(rooms.map((r) => repo.answersOfRoom(r)))).flat().filter((a) => (a.role ?? "guesser") === "guesser");
  const byQ = new Map<string, Map<string, number>>();
  for (const a of rows) {
    const k = `${a.roomCode}|${a.questionKey}|${Math.floor(a.at / 60_000)}`;
    const m = byQ.get(k) ?? new Map();
    m.set(a.userId, a.points);
    byQ.set(k, m);
  }
  const rec = (a: string, b: string) => {
    let w = 0,
      l = 0;
    for (const m of byQ.values()) {
      if (!m.has(a) || !m.has(b)) continue;
      if (m.get(a)! > m.get(b)!) w++;
      else if (m.get(a)! < m.get(b)!) l++;
    }
    return { w, l };
  };
  return (
    <div>
      <PageTitle kicker="HEAD TO HEAD" title="سجل المواجهات" />
      <p className="mb-4 text-sm text-muted">فوز = جاب نقاط أكثر من الثاني في نفس السؤال. الصف ضد العمود.</p>
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr>
              <th />
              {users.map((u) => (
                <th key={u.id} className="px-3 pb-2">
                  <Avatar name={u.name} color={u.color} icon={u.avatar} size={26} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="py-2 pe-3">{a.name}</td>
                {users.map((b) => {
                  if (a.id === b.id) return <td key={b.id} className="text-center text-faint">—</td>;
                  const r = rec(a.id, b.id);
                  return (
                    <td key={b.id} className={`num px-3 text-center ${r.w > r.l ? "text-ok" : r.w < r.l ? "text-signal" : "text-muted"}`}>
                      {r.w}–{r.l}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
