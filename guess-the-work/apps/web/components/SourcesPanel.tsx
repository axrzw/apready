"use client";
import { useRef, useState } from "react";
import { Icon } from "@/lib/icons";

type St = { cursor: number; total: number; added: number; status: string; error?: string; at: number };
type Src = { id: string; label: string; env: string[]; missing: string[]; state: St };

/** Status of every source + "pull now" in batches (each call ~40 s, resumes where it stopped). */
export default function SourcesPanel({ sources }: { sources: Src[] }) {
  const [list, setList] = useState(sources);
  const [running, setRunning] = useState<string | null>(null);
  const stop = useRef(false);
  const pull = async (id: string, restart: boolean) => {
    setRunning(id);
    stop.current = false;
    let first = true;
    for (;;) {
      const r = await fetch(`/api/admin/source/${id}${first && restart ? "?restart=1" : ""}`, { method: "POST" });
      first = false;
      const st = (await r.json()) as St & { error?: string };
      setList((l) => l.map((s) => (s.id === id ? { ...s, state: r.ok ? st : { ...s.state, status: "error", error: st.error } } : s)));
      if (!r.ok || st.status !== "running" || stop.current) break;
    }
    setRunning(null);
  };
  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl">المصادر</h2>
      <ul className="divide-y divide-line border-y border-line">
        {list.map((s) => {
          const pct = s.state.total ? Math.min(100, Math.round((s.state.cursor / s.state.total) * 100)) : 0;
          return (
            <li key={s.id} className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{s.label}</span>
                  {s.missing.length ? (
                    <span className="rounded-sm border border-signal/40 px-1.5 text-[11px] text-signal">ينقصه مفتاح: {s.missing.map((m) => <code key={m} className="mx-0.5">{m}</code>)}</span>
                  ) : (
                    <span className="rounded-sm border border-ok/40 px-1.5 text-[11px] text-ok">مفعّل</span>
                  )}
                </div>
                <div className="h-[3px] rounded-full bg-line">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="num text-xs text-faint">
                  {s.state.status === "done" ? "اكتمل" : s.state.status === "error" ? `خطأ: ${s.state.error}` : s.state.cursor ? `وقف عند ${s.state.cursor}/${s.state.total}` : "ما بدأ"} · أُضيف {s.state.added}
                </div>
              </div>
              <div className="flex gap-2">
                {running === s.id ? (
                  <button className="btn-ghost h-9" onClick={() => (stop.current = true)}>
                    <Icon name="Pause" size={16} /> إيقاف
                  </button>
                ) : (
                  <button className="btn-ghost h-9" disabled={!!s.missing.length || !!running} onClick={() => pull(s.id, s.state.status === "done")}>
                    <Icon name="Download" size={16} /> {s.state.cursor && s.state.status !== "done" ? "كمّل السحب" : "اسحب الحين"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
