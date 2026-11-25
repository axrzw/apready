"use client";
import { LayoutGroup, motion } from "framer-motion";
import { Icon } from "@/lib/icons";
import { Avatar, CountUp } from "./ui";
import type { View } from "./useRoom";

/** Ranking that re-orders with a spring when scores change. */
export default function Scoreboard({ view }: { view: View }) {
  return (
    <LayoutGroup>
      <ol className="space-y-1">
        {view.players.map((p, i) => (
          <motion.li layout transition={{ type: "spring", stiffness: 420, damping: 36 }} key={p.id} className={`flex items-center gap-3 rounded-sm px-2 py-1.5 ${p.id === view.me ? "bg-surface2" : ""}`}>
            <span className="num w-4 text-xs text-faint">{i + 1}</span>
            <Avatar name={p.name} color={p.color} icon={p.avatar} size={26} />
            <span className={`flex-1 truncate text-sm ${p.online ? "" : "opacity-40"}`}>
              {p.name}
              {p.id === view.hostId && <Icon name="Crown" size={12} className="ms-1.5 inline text-accent" />}
            </span>
            {p.streak >= 3 && (
              <span className="num flex items-center gap-0.5 text-xs text-accent" title="سلسلة">
                <Icon name="Flame" size={12} />
                {p.streak}
              </span>
            )}
            {view.phase === "question" && p.answered && <Icon name="Pen" size={13} className="text-muted" />}
            {view.phase === "reveal" && <Icon name={p.correct ? "Check" : "X"} size={14} className={p.correct ? "text-ok" : "text-faint"} />}
            <CountUp value={p.score} className="w-12 text-end text-sm text-text" />
          </motion.li>
        ))}
      </ol>
    </LayoutGroup>
  );
}
