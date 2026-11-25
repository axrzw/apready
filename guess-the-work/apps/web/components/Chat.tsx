"use client";
import { useEffect, useRef, useState } from "react";
import type { View } from "./useRoom";

export default function Chat({ view, onSend, placeholder }: { view: View; onSend: (t: string) => void; placeholder?: string }) {
  const [text, setText] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const names = Object.fromEntries(view.players.map((p) => [p.id, p.name]));
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [view.chat.length]);
  return (
    <div className="flex h-72 flex-col">
      <div ref={box} className="flex-1 space-y-1 overflow-y-auto pe-1 text-sm">
        {view.chat.map((m) => (
          <div key={m.id} className={m.kind === "system" ? "text-zinc-400" : m.kind === "describer" ? "text-brand-300" : ""}>
            {m.kind !== "system" && <b className="me-1">{names[m.playerId] ?? "?"}:</b>}
            <span className={m.masked ? "text-rose-300" : ""}>{m.text}</span>
          </div>
        ))}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onSend(text.trim());
          setText("");
        }}
      >
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder ?? "اكتب…"} maxLength={300} />
        <button className="btn-ghost">↩</button>
      </form>
    </div>
  );
}
