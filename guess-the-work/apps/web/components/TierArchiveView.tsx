"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import type { TierArchive, TierRow } from "@gtw/core/tierlist";
import { Icon } from "@/lib/icons";
import { TIER_COLOR, exportBoard, label } from "@/lib/tier-ui";
import { Board } from "./TierListView";
import { Avatar } from "./ui";

const STYLE_AR = { vote: "تصويت سري", discuss: "نقاش حر", solo: "كل واحد لوحته", guess_friend: "خمّن تير صاحبك" } as const;
const ORDER = "SABCDF";

/** One archived tier list: the group's board, everybody's boards, stats, the comparison with the original, «عيدها», a picture. */
export default function TierArchiveView({ id, t, parent }: { id: string; t: TierArchive; parent?: { board: Record<string, TierRow>; at: number } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const name = (uid?: string) => t.players.find((p) => p.id === uid)?.name ?? "؟";
  const title = t.style === "guess_friend" ? `لوحة ${name(t.target)}` : t.style === "solo" ? "لوحة المتوسط" : "لوحتنا";
  const item = (iid: string) => t.items.find((x) => x.id === iid);
  const changes = parent ? t.items.filter((it) => parent.board[it.id] && t.board[it.id] && parent.board[it.id] !== t.board[it.id]) : [];
  const ring = (uid: string) => {
    const r: Record<string, string> = {};
    for (const it of t.items) {
      const mine = t.boards[uid]?.[it.id] ?? t.results[it.id]?.opinions[uid];
      const g = t.board[it.id];
      if (mine && mine !== "unseen" && g && Math.abs(ORDER.indexOf(mine) - ORDER.indexOf(g)) >= 2) r[it.id] = "rgb(217 80 63)";
    }
    return r;
  };
  // each player's own board: individual boards, or their votes / opinions
  const boardOf = (uid: string): Record<string, TierRow | "unseen"> => t.boards[uid] ?? Object.fromEntries(Object.entries(t.results).flatMap(([iid, r]) => (r.opinions[uid] ? [[iid, r.opinions[uid]]] : [])));
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">{STYLE_AR[t.style]}</span>
        <span className="num text-sm text-faint">· {t.items.length} عنصر</span>
        <div className="ms-auto flex gap-2">
          <button
            className="btn-quiet border border-line"
            onClick={async () => {
              const url = await exportBoard(title, t.items, t.board);
              const a = document.createElement("a");
              a.href = url;
              a.download = "tier-list.png";
              a.click();
            }}
          >
            <Icon name="Download" size={16} /> صورة
          </button>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await fetch("/api/rooms", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ settings: { kind: "tierlist", count: t.items.length, tier: { style: t.style, topic: t.topic, source: "manual", manual: t.items.map((x) => x.id), parent: id, target: t.target } } }),
              });
              const j = await r.json();
              if (j.code) router.push(`/room/${j.code}`);
              else setBusy(false);
            }}
          >
            <Icon name="RotateCcw" size={16} /> عيدها
          </button>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="font-display text-2xl">{title}</h2>
        <Board items={t.items} board={t.board} />
      </section>

      {parent && (
        <section className="space-y-2">
          <h2 className="font-display text-xl">وش تغيّر من المرة الأولى</h2>
          {!changes.length ? (
            <p className="text-sm text-muted">نفس اللوحة بالضبط. ثابتين على رأيكم.</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {changes.map((it) => (
                <li key={it.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1 truncate">{label(it)}</span>
                  <span className="font-display text-lg" style={{ color: TIER_COLOR[parent.board[it.id]] }}>
                    {parent.board[it.id]}
                  </span>
                  <Icon name="ArrowLeft" size={14} className="text-faint ltr:rotate-180" />
                  <span className="font-display text-lg" style={{ color: TIER_COLOR[t.board[it.id]] }}>
                    {t.board[it.id]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          t.stats.aligned && ["الأقرب للقروب", name(t.stats.aligned.id)],
          t.stats.outlier && ["الشاذ", name(t.stats.outlier.id)],
          t.stats.disputed && ["أكثر عنصر عليه خلاف", label(item(t.stats.disputed.id) ?? { title: "؟" })],
          t.stats.agreed && ["أكثر عنصر متفقين عليه", label(item(t.stats.agreed.id) ?? { title: "؟" })],
        ]
          .filter((x): x is string[] => !!x)
          .map(([k, v]) => (
            <div key={k} className="panel p-3">
              <div className="label">{k}</div>
              <div className="mt-1 truncate font-display text-lg">{v}</div>
            </div>
          ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl">كل واحد ورأيه</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          {t.players.map((p, i) => (
            <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm">
                <Avatar name={p.name} color={p.color} icon={p.avatar} size={22} />
                {p.name}
                <span className="num ms-auto text-xs text-muted">+{t.points[p.id] ?? 0}</span>
              </div>
              <Board items={t.items} board={boardOf(p.id)} rings={ring(p.id)} compact />
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}
