"use client";
import { motion } from "framer-motion";
import { Avatar, CountUp } from "./ui";

export default function LeaderTable({ rows }: { rows: { userId: string; name: string; points: number; correct: number; answers: number; color?: string; avatar?: string; title?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.points));
  return (
    <ol className="divide-y divide-line border-y border-line">
      {rows.map((r, i) => (
        <motion.li layout key={r.userId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="grid grid-cols-[2rem_auto_1fr_auto] items-center gap-3 py-3">
          <span className={`num font-display text-2xl ${i === 0 ? "text-accent" : "text-faint"}`}>{i + 1}</span>
          <Avatar name={r.name} color={r.color} icon={r.avatar} size={34} />
          <div className="min-w-0">
            <div className="truncate">
              {r.name}
              {r.title && <span className="ms-2 text-xs text-accent/80">{r.title}</span>}
            </div>
            <div className="mt-1 h-[3px] rounded-full bg-line">
              <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${(r.points / max) * 100}%` }} transition={{ duration: 0.8, delay: 0.1 + i * 0.04 }} />
            </div>
          </div>
          <div className="text-end">
            <CountUp value={r.points} className="font-display text-xl" />
            <div className="num text-xs text-faint">
              {r.correct}/{r.answers} · {r.answers ? Math.round((r.correct / r.answers) * 100) : 0}%
            </div>
          </div>
        </motion.li>
      ))}
    </ol>
  );
}
