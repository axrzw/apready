"use client";
import { useEffect, useState } from "react";
import type { Character, Work } from "@gtw/core/types";
import { CATEGORIES } from "@gtw/core/types";
import { CATEGORY_AR, TIER_AR } from "@gtw/core/i18n";

type Row = Work & { characters: Character[] };

async function post(body: unknown) {
  const r = await fetch("/api/admin/work", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

export default function WorksAdmin() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const load = async () => setRows(await (await fetch(`/api/admin/works?q=${encodeURIComponent(q)}`)).json());
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">📚 الأعمال والأسماء العربية</h1>
      <input className="input" placeholder="ابحث بالاسم…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="space-y-2">
        {rows.map((w) => (
          <div key={w.id} className="card">
            <button className="flex w-full items-center gap-3 text-start" onClick={() => setOpen(open === w.id ? null : w.id)}>
              {w.posterUrl && <img src={w.posterUrl} alt="" className="h-16 w-11 rounded object-cover" referrerPolicy="no-referrer" />}
              <div className="flex-1">
                <div className="font-bold">
                  {w.title} {w.titleAr && <span className="text-brand-300">· {w.titleAr}</span>}
                </div>
                <div className="text-xs text-zinc-400">
                  {CATEGORY_AR[w.category]} · {TIER_AR[w.tier]} · {w.year ?? "?"} · {w.id}
                </div>
              </div>
            </button>
            {open === w.id && (
              <div className="mt-3 space-y-3 border-t border-ink-700 pt-3 text-sm">
                <div className="text-zinc-400">الأسماء المقبولة: {[w.title, w.titleAr, ...w.aliases].filter(Boolean).join(" · ")}</div>
                <NameEditor label="العمل" onSave={async (nameAr, alias) => (await post({ kind: "work", id: w.id, nameAr, alias }), load())} />
                {w.characters.map((c) => (
                  <div key={c.id} className="flex items-center gap-2">
                    {c.imageUrl && <img src={c.imageUrl} alt="" className="h-10 w-10 rounded object-cover" referrerPolicy="no-referrer" />}
                    <div className="w-48">
                      {c.name} {c.nameAr && <span className="text-brand-300">· {c.nameAr}</span>}
                    </div>
                    <NameEditor label="" small onSave={async (nameAr, alias) => (await post({ kind: "character", id: c.id, nameAr, alias }), load())} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <NewWork onDone={load} />
    </div>
  );
}

function NameEditor({ label, onSave, small }: { label: string; onSave: (nameAr?: string, alias?: string) => Promise<unknown>; small?: boolean }) {
  const [ar, setAr] = useState("");
  const [alias, setAlias] = useState("");
  return (
    <form
      className="flex flex-1 flex-wrap items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        await onSave(ar || undefined, alias || undefined);
        setAr("");
        setAlias("");
      }}
    >
      {label && <span className="w-12 text-zinc-400">{label}</span>}
      <input className={`input ${small ? "py-1" : ""} w-48`} placeholder="الاسم العربي / الدبلجة" value={ar} onChange={(e) => setAr(e.target.value)} />
      <input className={`input ${small ? "py-1" : ""} w-48`} placeholder="اسم بديل (اختصار، حرفي…)" value={alias} onChange={(e) => setAlias(e.target.value)} />
      <button className="btn-ghost py-1">حفظ</button>
    </form>
  );
}

function NewWork({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ category: "anime", title: "", titleAr: "", year: "", popularity: "0", score: "", posterUrl: "", aliases: "" });
  const [msg, setMsg] = useState("");
  return (
    <form
      className="card grid gap-2 sm:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await post({ create: { ...f, aliases: f.aliases.split(",").map((x) => x.trim()).filter(Boolean) } });
        setMsg(r.ok ? `انضاف: ${r.id}` : r.error);
        onDone();
      }}
    >
      <h2 className="font-bold sm:col-span-4">➕ إضافة عمل يدوياً</h2>
      <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_AR[c]}
          </option>
        ))}
      </select>
      <input className="input" required placeholder="الاسم الأصلي/الإنجليزي" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <input className="input" placeholder="الاسم العربي" value={f.titleAr} onChange={(e) => setF({ ...f, titleAr: e.target.value })} />
      <input className="input" placeholder="أسماء بديلة (فاصلة)" value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} />
      <input className="input" placeholder="السنة" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} />
      <input className="input" placeholder="الشعبية (عدد)" value={f.popularity} onChange={(e) => setF({ ...f, popularity: e.target.value })} />
      <input className="input" placeholder="التقييم 0-100" value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })} />
      <input className="input" placeholder="رابط البوستر" value={f.posterUrl} onChange={(e) => setF({ ...f, posterUrl: e.target.value })} />
      <button className="btn-primary sm:col-span-4">أضف</button>
      {msg && <p className="text-sm text-brand-300 sm:col-span-4">{msg}</p>}
    </form>
  );
}
