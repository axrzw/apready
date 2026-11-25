"use client";
import { LayoutGroup, motion } from "framer-motion";
import { Icon } from "@/lib/icons";
import { Avatar, CountUp } from "./ui";
import type { View } from "./useRoom";

/** Ranking that re-orders with a spring when scores change. */
export default function Scoreboard({ view, act }: { view: View; act?: (a: Record<string, unknown>) => Promise<unknown> }) {
  const host = view.hostId === view.me;
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
              {p.spectator && <span className="ms-1.5 text-[11px] text-faint">يتفرج</span>}
              {view.titles?.[p.id]?.[0] && <span className="block text-[11px] leading-tight text-accent/80">{view.titles[p.id][0]}</span>}
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
            {host && act && p.id !== view.me && (
              <details className="relative">
                <summary className="cursor-pointer list-none px-1 text-faint hover:text-text" aria-label="host menu">
                  <Icon name="Settings2" size={14} />
                </summary>
                <div className="absolute end-0 z-30 mt-1 w-40 overflow-hidden rounded-md border border-lineStrong bg-raise text-sm shadow-xl">
                  <button className="block w-full px-3 py-2 text-start hover:bg-surface2" onClick={() => act({ type: "transfer", playerId: p.id })}>
                    خله المضيف
                  </button>
                  <button className="block w-full px-3 py-2 text-start text-signal hover:bg-surface2" onClick={() => confirm(`تطرد ${p.name}؟`) && act({ type: "kick", playerId: p.id })}>
                    اطرده
                  </button>
                </div>
              </details>
            )}
          </motion.li>
        ))}
      </ol>
    </LayoutGroup>
  );
}
