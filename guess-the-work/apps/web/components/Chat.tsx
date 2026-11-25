"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icons";
import type { View } from "./useRoom";

export default function Chat({ view, onSend, placeholder }: { view: View; onSend: (t: string) => void; placeholder?: string }) {
  const [text, setText] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const players = Object.fromEntries(view.players.map((p) => [p.id, p]));
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [view.chat.length]);
  return (
    <div className="flex h-64 flex-col">
      <div ref={box} className="flex-1 space-y-1.5 overflow-y-auto pe-1 text-sm">
        {view.chat.length === 0 && <p className="pt-6 text-center text-xs text-faint">الشات فاضي</p>}
        {view.chat.map((m) =>
          m.kind === "system" ? (
            <div key={m.id} className="text-center text-xs text-faint">
              {m.text}
            </div>
          ) : (
            <div key={m.id} className="leading-relaxed">
              <b className="me-1.5 font-semibold" style={{ color: players[m.playerId]?.color }}>
                {players[m.playerId]?.name ?? "؟"}
              </b>
              <span className={m.masked ? "text-signal" : m.kind === "describer" ? "text-accent" : "text-text/90"}>{m.text}</span>
            </div>
          ),
        )}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onSend(text.trim());
          setText("");
        }}
      >
        <input className="field h-10" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder ?? "اكتب"} maxLength={300} />
        <button className="btn-ghost h-10 px-3" aria-label="send">
          <Icon name="Send" size={16} className="rtl:-scale-x-100" />
        </button>
      </form>
    </div>
  );
}
