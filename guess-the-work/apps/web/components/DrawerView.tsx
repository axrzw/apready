"use client";
import { useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { useTick, type View } from "./useRoom";
import DrawCanvas from "./DrawCanvas";

interface Item {
  title: string;
  titleAr?: string;
  sub?: string;
  image: string;
  kind?: "work" | "character";
}
interface DV {
  myOffers?: Item[];
  myItem?: Item;
  submitted: string[];
  current?: { id: string; by: string; png: string; index: number; total: number; kind: "work" | "character"; mine?: { work: boolean; specific: boolean } };
  gallery?: { id: string; by: string; png: string; original: string; title: string; titleAr?: string; sub?: string; votesBest: number; votesFunny: number }[];
  myVotes?: { best?: string; funny?: string };
}

export default function DrawerView({ view, act, lang }: { view: View; act: (a: Record<string, unknown>) => Promise<unknown>; lang: Lang }) {
  useTick(500);
  const d = view.party as DV | undefined;
  const [guess, setGuess] = useState("");
  const exportRef = useRef<(() => void) | null>(null);
  const sent = d?.submitted.includes(view.me);
  const L = (x: { title: string; titleAr?: string }) => (lang === "ar" ? x.titleAr || x.title : x.title);
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? "؟";

  // time almost up: send what is on the canvas
  useEffect(() => {
    if (view.phase !== "draw" || sent || !view.phaseEndsAt) return;
    const left = view.phaseEndsAt - view.serverNow;
    const tm = setTimeout(() => exportRef.current?.(), Math.max(0, left - 2500));
    return () => clearTimeout(tm);
  }, [view.phase, view.phaseEndsAt, view.serverNow, sent]);

  if (!d) return null;

  if (view.phase === "draw")
    return (
      <div className="space-y-3">
        {d.myOffers && (
          <div>
            <p className="mb-2 text-center font-bold">اختر وش بترسم (يشوفه أنت بس):</p>
            <div className="grid grid-cols-2 gap-3">
              {d.myOffers.map((o, i) => (
                <button key={i} className="card hover:border-brand-500" onClick={() => act({ type: "draw_choose", index: i })}>
                  <img src={o.image} alt="" className="mx-auto h-40 rounded-lg object-contain" />
                  <div className="mt-2 font-bold">{L(o)}</div>
                  {o.sub && <div className="text-sm text-zinc-400">{o.sub}</div>}
                </button>
              ))}
            </div>
          </div>
        )}
        {d.myItem && (
          <div className="grid gap-3 md:grid-cols-[180px_1fr]">
            <div className="card text-center">
              <img src={d.myItem.image} alt="" className="mx-auto max-h-56 rounded-lg object-contain" />
              <div className="mt-2 font-bold text-brand-300">{L(d.myItem)}</div>
              {d.myItem.sub && <div className="text-sm text-zinc-400">{d.myItem.sub}</div>}
            </div>
            {sent ? (
              <p className="card grid place-items-center text-center text-emerald-300">✅ وصلت رسمتك. ننتظر الباقين ({d.submitted.length}/{view.players.length})</p>
            ) : (
              <CanvasWithRef exportRef={exportRef} onExport={(png) => act({ type: "draw_submit", png })} />
            )}
          </div>
        )}
      </div>
    );

  if (view.phase === "draw_guess" && d.current) {
    const own = d.current.by === view.me;
    return (
      <div className="space-y-3">
        <p className="text-center text-zinc-400">
          رسمة {d.current.index + 1} من {d.current.total} · رسمها {own ? "أنت" : "واحد منكم 🤫"}
        </p>
        <img src={d.current.png} alt="" className="mx-auto max-h-[55vh] rounded-xl border border-ink-600 bg-white" />
        {own ? (
          <p className="card text-center">هذي رسمتك، ما تخمّن عليها 😄</p>
        ) : d.current.mine?.work && (d.current.kind === "work" || d.current.mine.specific) ? (
          <p className="card text-center text-emerald-300">✅ عرفتها كلها!</p>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (guess.trim()) await act({ type: "answer", submission: { text: guess } });
              setGuess("");
            }}
          >
            <input className="input text-lg" value={guess} onChange={(e) => setGuess(e.target.value)} placeholder={d.current.mine?.work ? "عرفت العمل! وش الشخصية؟ (نقاط إضافية)" : "وش العمل؟ (والشخصية لنقاط إضافية)"} autoFocus />
            <button className="btn-primary">خمّن</button>
          </form>
        )}
      </div>
    );
  }

  if ((view.phase === "draw_vote" || view.phase === "finished") && d.gallery)
    return (
      <div className="space-y-3">
        <p className="text-center font-bold">{view.phase === "draw_vote" ? "صوّت: أفضل رسمة 🏆 وأضحك رسمة 😂" : "المعرض"}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {d.gallery.map((g) => (
            <div key={g.id} className="card space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <img src={g.png} alt="" className="h-40 w-full rounded-lg bg-white object-contain" />
                <img src={g.original} alt="" className="h-40 w-full rounded-lg object-contain" />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>
                  <b>{name(g.by)}</b> رسم «{L(g)}»
                </span>
                <a className="chip" href={g.png} download={`drawing-${g.id}.png`}>
                  ⬇ PNG
                </a>
              </div>
              {view.phase === "draw_vote" && g.by !== view.me ? (
                <div className="flex gap-2">
                  <button className={`chip ${d.myVotes?.best === g.id ? "chip-on" : ""}`} onClick={() => act({ type: "draw_vote", drawingId: g.id, kind: "best" })}>
                    🏆 أفضل
                  </button>
                  <button className={`chip ${d.myVotes?.funny === g.id ? "chip-on" : ""}`} onClick={() => act({ type: "draw_vote", drawingId: g.id, kind: "funny" })}>
                    😂 أضحك
                  </button>
                </div>
              ) : (
                view.phase === "finished" && (
                  <div className="text-sm text-zinc-400">
                    🏆 {g.votesBest} · 😂 {g.votesFunny}
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      </div>
    );
  return null;
}

function CanvasWithRef({ exportRef, onExport }: { exportRef: React.MutableRefObject<(() => void) | null>; onExport: (png: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    exportRef.current = () => {
      const c = wrap.current?.querySelector("canvas");
      if (c) onExport(c.toDataURL("image/png"));
    };
    return () => {
      exportRef.current = null;
    };
  }, [exportRef, onExport]);
  return (
    <div ref={wrap}>
      <DrawCanvas onExport={onExport} />
    </div>
  );
}
