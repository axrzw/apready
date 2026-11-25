"use client";
import { useState } from "react";
import { TIERS, type TierMix } from "@gtw/core/types";
import { TIER_AR } from "@gtw/core/i18n";
import { Icon } from "@/lib/icons";

export default function AdminActions({ jobs, running, mix, ytdlp }: { jobs: { id: string; label: string }[]; running: string[]; mix: TierMix; ytdlp: boolean }) {
  const [m, setM] = useState(mix);
  const [msg, setMsg] = useState("");
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="panel p-4 space-y-2">
        <h2 className="font-bold">تشغيل مهام السحب يدوياً</h2>
        {jobs.map((j) => (
          <button
            key={j.id}
            className="btn-ghost w-full justify-start text-start text-sm"
            disabled={running.includes(j.id)}
            onClick={async () => {
              const r = await fetch("/api/admin/job", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: j.id }) });
              const x = await r.json();
              setMsg(r.ok ? `بدأت: ${j.label} (السجل: ${x.log})` : x.error);
            }}
          >
            <Icon name={running.includes(j.id) ? "Timer" : "Play"} size={16} className="shrink-0 text-accent" /> {j.label}
          </button>
        ))}
        <p className="text-xs text-faint">yt-dlp: {ytdlp ? "موجود" : "مو موجود (أداة القص تقبل روابط ملفات مباشرة بس)"}</p>
        {msg && <p className="text-sm text-accent">{msg}</p>}
      </div>
      <div className="panel p-4 space-y-2">
        <h2 className="font-bold">نسب الطبقات الافتراضية للغرف الجديدة</h2>
        {TIERS.map((t) => (
          <label key={t} className="flex items-center gap-2 text-sm">
            <span className="w-16">{TIER_AR[t]}</span>
            <input type="range" min={0} max={100} value={m[t]} onChange={(e) => setM({ ...m, [t]: Number(e.target.value) })} className="flex-1 accent-[var(--accent)]" />
            <span className="w-8">{m[t]}</span>
          </label>
        ))}
        <button
          className="btn-primary"
          onClick={async () => {
            await fetch("/api/admin/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mix: m }) });
            setMsg("انحفظت النسب");
          }}
        >
          حفظ
        </button>
      </div>
    </div>
  );
}
