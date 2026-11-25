"use client";
import type { View } from "./useRoom";

export default function Scoreboard({ view, highlight }: { view: View; highlight?: Record<string, string> }) {
  return (
    <ol className="space-y-1">
      {view.players.map((p, i) => (
        <li key={p.id} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${p.id === view.me ? "bg-ink-700" : ""}`}>
          <span className="w-5 text-zinc-500">{i + 1}</span>
          {p.avatar ? <img src={p.avatar} className="h-6 w-6 rounded-full" alt="" /> : <span className="grid h-6 w-6 place-items-center rounded-full bg-ink-600 text-xs">{p.name[0]}</span>}
          <span className={`flex-1 truncate ${p.online ? "" : "opacity-50"}`}>
            {p.name}
            {p.id === view.hostId && <span title="المضيف"> 👑</span>}
            {p.streak >= 3 && <span title="سلسلة"> 🔥{p.streak}</span>}
          </span>
          {highlight?.[p.id] && <span>{highlight[p.id]}</span>}
          {view.phase === "question" && p.answered && <span title="جاوب">✍️</span>}
          {view.phase === "reveal" && (p.correct ? <span>✅</span> : <span className="opacity-60">❌</span>)}
          <span className="font-mono tabular-nums text-brand-300">{p.score}</span>
        </li>
      ))}
    </ol>
  );
}
