"use client";
import { useState } from "react";

export default function ProfileForm({ linked }: { linked: Record<string, string | undefined> }) {
  const [f, setF] = useState({ anilist: linked.anilist ?? "", mal: linked.mal ?? "", steam: linked.steam ?? "", letterboxd: linked.letterboxd ?? "" });
  const [ok, setOk] = useState(false);
  const fields: [keyof typeof f, string, string][] = [
    ["anilist", "AniList (اسم المستخدم)", "يشتغل"],
    ["mal", "MyAnimeList (اسم المستخدم)", "يبي MAL_CLIENT_ID عند الأدمن"],
    ["steam", "Steam", "لاحقاً"],
    ["letterboxd", "Letterboxd", "لاحقاً"],
  ];
  return (
    <form
      className="card space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
        setOk(true);
      }}
    >
      {fields.map(([k, label, note]) => (
        <label key={k} className="block">
          <span className="label">
            {label} <span className="text-xs text-zinc-500">({note})</span>
          </span>
          <input className="input" dir="ltr" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        </label>
      ))}
      <button className="btn-primary">حفظ</button>
      {ok && <p className="text-emerald-300">انحفظ ✔</p>}
    </form>
  );
}
