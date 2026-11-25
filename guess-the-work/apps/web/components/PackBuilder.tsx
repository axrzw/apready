"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MODES } from "@gtw/core/questions";
import type { ModeId } from "@gtw/core/types";
import { Icon } from "@/lib/icons";
import { Segmented, Skeleton } from "./ui";

type Row = { workId: string; title: string; modes: ModeId[] };

/** Pick works from your log, a mode for each, a difficulty and a name. */
export default function PackBuilder() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [chosen, setChosen] = useState<Record<string, ModeId>>({});
  const [name, setName] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "normal" | "hard">("normal");
  const [msg, setMsg] = useState("");
  useEffect(() => void fetch("/api/packs").then((r) => r.json()).then(setRows), []);
  const mode = (id: ModeId) => MODES.find((m) => m.id === id);
  return (
    <section className="panel space-y-4 p-4">
      <h2 className="font-display text-xl">ابنِ باقة</h2>
      {!rows ? (
        <Skeleton className="h-40" />
      ) : !rows.length ? (
        <p className="text-sm text-muted">سجّل أعمال شفتها في «سجلّي» أول، وبعدها تقدر تبني منها باقة.</p>
      ) : (
        <>
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {rows.map((r) => (
              <li key={r.workId} className="flex flex-wrap items-center gap-2 py-1">
                <button className={`toggle h-8 ${chosen[r.workId] ? "toggle-on" : ""}`} onClick={() => setChosen((c) => (c[r.workId] ? Object.fromEntries(Object.entries(c).filter(([k]) => k !== r.workId)) : { ...c, [r.workId]: r.modes[0] }))}>
                  {chosen[r.workId] && <Icon name="Check" size={14} />}
                  <span data-bidi>{r.title}</span>
                </button>
                {chosen[r.workId] && (
                  <select className="field h-8 w-auto px-2 text-sm" value={chosen[r.workId]} onChange={(e) => setChosen((c) => ({ ...c, [r.workId]: e.target.value as ModeId }))}>
                    {r.modes.map((m) => (
                      <option key={m} value={m}>
                        {mode(m)?.ar}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            ))}
          </ul>
          <Segmented
            value={difficulty}
            onChange={setDifficulty}
            options={[
              { value: "easy", label: "سهلة" },
              { value: "normal", label: "عادية" },
              { value: "hard", label: "صعبة" },
            ]}
          />
          <div className="flex gap-2">
            <input className="field" placeholder="اسم الباقة" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            <button
              className="btn-primary"
              disabled={!name.trim() || !Object.keys(chosen).length}
              onClick={async () => {
                const r = await fetch("/api/packs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, difficulty, items: Object.entries(chosen).map(([workId, mode]) => ({ workId, mode })) }) });
                setMsg(r.ok ? "انحفظت الباقة" : (await r.json()).error);
                if (r.ok) router.refresh();
              }}
            >
              احفظ
            </button>
          </div>
          <p className="num text-xs text-faint">
            مختار {Object.keys(chosen).length} {msg && `· ${msg}`}
          </p>
        </>
      )}
    </section>
  );
}
