"use client";
import { useState } from "react";
import type { Lang } from "@/lib/i18n";
import type { View } from "./useRoom";

interface DV {
  describerId?: string;
  turn: number;
  totalTurns: number;
  skipsLeft?: number;
  offered?: { title: string; titleAr?: string; sub?: string; image: string }[];
  item?: { title: string; titleAr?: string; sub?: string; image: string; forbidden: string[] };
  reveal?: { title: string; titleAr?: string; sub?: string; image: string };
  guessed: Record<string, number>;
  penalty: number;
  via: "voice" | "chat";
}

export default function DescriberView({ view, act, lang }: { view: View; act: (a: Record<string, unknown>) => Promise<unknown>; lang: Lang }) {
  const d = view.party as DV | undefined;
  const [guess, setGuess] = useState("");
  if (!d) return null;
  const mine = d.describerId === view.me;
  const name = view.players.find((p) => p.id === d.describerId)?.name ?? "؟";
  const L = (x: { title: string; titleAr?: string }) => (lang === "ar" ? x.titleAr || x.title : x.title);
  return (
    <div className="space-y-4">
      <p className="text-center text-zinc-400">
        الدور {d.turn + 1} من {d.totalTurns} · الواصف: <b className="text-white">{name}</b> {d.via === "voice" ? "🎙️ (صوتياً في الديسكورد)" : "⌨️ (كتابة في الشات)"}
      </p>
      {view.phase === "describe_choose" &&
        (mine && d.offered?.length ? (
          <div>
            <p className="mb-2 text-center font-bold">اختر وش بتوصف (يشوفه أنت بس):</p>
            <div className="grid grid-cols-2 gap-3">
              {d.offered.map((o, i) => (
                <button key={i} className="card hover:border-brand-500" onClick={() => act({ type: "describe_choose", index: i })}>
                  <img src={o.image} alt="" className="mx-auto h-48 rounded-lg object-contain" />
                  <div className="mt-2 font-bold">{L(o)}</div>
                  {o.sub && <div className="text-sm text-zinc-400">{o.sub}</div>}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="card text-center text-zinc-400">{mine ? "نجهّز لك العناصر…" : `${name} يختار…`}</p>
        ))}
      {view.phase === "describe_turn" && mine && d.item && (
        <div className="card space-y-3">
          <div className="flex gap-4">
            <img src={d.item.image} alt="" className="h-56 rounded-lg object-contain" />
            <div className="space-y-2">
              <div className="text-2xl font-black text-brand-300">{L(d.item)}</div>
              {d.item.sub && <div className="text-zinc-400">{d.item.sub}</div>}
              <div className="text-sm text-rose-300">ممنوع تقول (تنحجب ويخصم منك):</div>
              <div className="flex flex-wrap gap-1">
                {d.item.forbidden.map((f) => (
                  <span key={f} className="chip border-rose-500/40 text-rose-200">
                    {f}
                  </span>
                ))}
              </div>
              {d.penalty > 0 && <div className="text-rose-400">خصم: -{d.penalty}</div>}
            </div>
          </div>
          {!!d.skipsLeft && (
            <button className="btn-ghost" onClick={() => act({ type: "describe_skip" })}>
              ⏭ تخطي (مرة وحدة)
            </button>
          )}
        </div>
      )}
      {view.phase === "describe_turn" && !mine && (
        <div className="space-y-3">
          <p className="card text-center text-lg">
            {d.via === "voice" ? `اسمع ${name} في الديسكورد واكتب تخمينك` : `اقرأ وصف ${name} في الشات واكتب تخمينك`}
            {d.guessed[view.me] === 1 && <span className="block text-emerald-300">✅ عرفتها!</span>}
            {d.guessed[view.me] && d.guessed[view.me] < 1 && <span className="block text-amber-300">🟡 عرفت العمل، جرب اسم الشخصية</span>}
          </p>
          {d.guessed[view.me] !== 1 && (
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (guess.trim()) await act({ type: "answer", submission: { text: guess } });
                setGuess("");
              }}
            >
              <input className="input text-lg" value={guess} onChange={(e) => setGuess(e.target.value)} placeholder="تخمينك…" autoFocus />
              <button className="btn-primary">خمّن</button>
            </form>
          )}
        </div>
      )}
      {view.phase === "describe_reveal" && d.reveal && (
        <div className="card pop flex items-center gap-4">
          <img src={d.reveal.image} alt="" className="h-40 rounded-lg object-contain" />
          <div>
            <div className="text-sm text-zinc-400">كان:</div>
            <div className="text-2xl font-black text-brand-300">{L(d.reveal)}</div>
            {d.reveal.sub && <div className="text-zinc-400">{d.reveal.sub}</div>}
            <div className="mt-2 text-sm">عرفوها: {Object.keys(d.guessed).map((id) => view.players.find((p) => p.id === id)?.name).join("، ") || "ولا أحد 😅"}</div>
          </div>
        </div>
      )}
    </div>
  );
}
