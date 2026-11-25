"use client";
import { useState } from "react";

export default function ClipsAdmin({ ytdlp }: { ytdlp: boolean }) {
  const [f, setF] = useState({ workId: "", q: "", type: "OST", url: "", start: "0", end: "20", song: "", artists: "" });
  const [found, setFound] = useState<{ id: string; title: string; titleAr?: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-black">✂️ إضافة أوستات ومشاهد</h1>
      <p className="text-sm text-zinc-400">
        حط رابط المقطع وتوقيت البداية والنهاية، والسيرفر يقصه ويخزنه (للاستخدام الخاص بيننا). {ytdlp ? "روابط يوتيوب تشتغل (yt-dlp موجود)." : "yt-dlp مو مثبت: استخدم رابط ملف مباشر (mp3/mp4/webm…)."}
      </p>
      <form
        className="card grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg("");
          const r = await fetch("/api/admin/clip", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, start: Number(f.start), end: Number(f.end) }) });
          const j = await r.json();
          setBusy(false);
          setMsg(r.ok ? `✔ انحفظ (${j.id})` : `✖ ${j.error}`);
        }}
      >
        <div className="sm:col-span-2">
          <span className="label">العمل</span>
          <input
            className="input"
            placeholder="ابحث…"
            value={f.q}
            onChange={async (e) => {
              setF({ ...f, q: e.target.value });
              if (e.target.value.length > 1) setFound(await (await fetch(`/api/admin/works?q=${encodeURIComponent(e.target.value)}`)).json());
            }}
          />
          <div className="mt-1 flex flex-wrap gap-1">
            {found.slice(0, 8).map((w) => (
              <button type="button" key={w.id} className={`chip ${f.workId === w.id ? "chip-on" : ""}`} onClick={() => setF({ ...f, workId: w.id })}>
                {w.titleAr ?? w.title}
              </button>
            ))}
          </div>
        </div>
        <label>
          <span className="label">النوع</span>
          <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="OST">أوست (صوت)</option>
            <option value="OP">أوبننق (صوت)</option>
            <option value="ED">إندنق (صوت)</option>
            <option value="scene">مقطع مشهد (فيديو)</option>
            <option value="frame">لقطة مشهد (صورة)</option>
          </select>
        </label>
        <label>
          <span className="label">الرابط</span>
          <input className="input" required value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} dir="ltr" />
        </label>
        <label>
          <span className="label">البداية (ثانية)</span>
          <input className="input" type="number" step="0.1" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
        </label>
        <label>
          <span className="label">النهاية (ثانية)</span>
          <input className="input" type="number" step="0.1" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
        </label>
        {f.type !== "scene" && f.type !== "frame" && (
          <>
            <input className="input" placeholder="اسم الأغنية/المقطوعة" value={f.song} onChange={(e) => setF({ ...f, song: e.target.value })} />
            <input className="input" placeholder="الفنان/الملحن (فاصلة)" value={f.artists} onChange={(e) => setF({ ...f, artists: e.target.value })} />
          </>
        )}
        <button className="btn-primary sm:col-span-2" disabled={!f.workId || busy}>
          {busy ? "يقص…" : "قص واحفظ"}
        </button>
        {msg && <p className="sm:col-span-2">{msg}</p>}
      </form>
    </div>
  );
}
