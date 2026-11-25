"use client";
import { useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { useTick, type View } from "./useRoom";
import DrawCanvas from "./DrawCanvas";
import { Icon } from "@/lib/icons";

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
  round?: number;
  rounds?: number | null;
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
        {(d.rounds ?? 2) > 1 && (
          <p className="num text-center text-sm text-muted">
            الجولة {d.round}
            {d.rounds ? ` من ${d.rounds}` : ""}
          </p>
        )}
        {!d.myOffers && !d.myItem && (
          <p className="flex items-center justify-center gap-2 py-10 text-muted">
            <Icon name="Timer" size={18} /> نجهّز رسومات الجولة
          </p>
        )}
        {d.myOffers && (
          <div>
            <p className="mb-3 text-center font-display text-xl">اختر وش بترسم. تشوفه أنت بس.</p>
            <div className="grid grid-cols-2 gap-3">
              {d.myOffers.map((o, i) => (
                <button key={i} className="group space-y-2 text-start" onClick={() => act({ type: "draw_choose", index: i })}>
                  <img src={o.image} alt="" className="aspect-[2/3] w-full rounded-md border border-line object-cover transition group-hover:border-accent" />
                  <div className="font-display text-lg leading-tight">{L(o)}</div>
                  {o.sub && <div className="text-xs text-muted">{o.sub}</div>}
                </button>
              ))}
            </div>
          </div>
        )}
        {d.myItem && (
          <div className="grid gap-3 md:grid-cols-[180px_1fr]">
            <div className="space-y-2 text-center">
              <img src={d.myItem.image} alt="" className="mx-auto aspect-[2/3] w-full max-w-[180px] rounded-md object-cover" />
              <div className="font-display text-xl text-accent">{L(d.myItem)}</div>
              {d.myItem.sub && <div className="text-xs text-muted">{d.myItem.sub}</div>}
            </div>
            {sent ? (
              <div className="paper grid min-h-64 place-items-center rounded-md text-center text-[#3b3226]"><p className="flex items-center gap-2"><Icon name="Check" /> وصلت رسمتك. ننتظر الباقين <span className="num">({d.submitted.length}/{view.players.length})</span></p></div>
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
        <p className="num text-center text-sm text-muted">
          رسمة {d.current.index + 1} من {d.current.total} · {own ? "هذي رسمتك" : "رسمها واحد منكم"}
        </p>
        <img src={d.current.png} alt="" className="paper mx-auto max-h-[52dvh] rounded-md p-2" />
        {own ? (
          <p className="text-center text-muted">هذي رسمتك، ما تخمّن عليها.</p>
        ) : d.current.mine?.work && (d.current.kind === "work" || d.current.mine.specific) ? (
          <p className="flex items-center justify-center gap-2 text-ok"><Icon name="Check" /> عرفتها كلها</p>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (guess.trim()) await act({ type: "answer", submission: { text: guess } });
              setGuess("");
            }}
          >
            <input className="field h-12 text-base" value={guess} onChange={(e) => setGuess(e.target.value)} placeholder={d.current.mine?.work ? "عرفت العمل! وش الشخصية؟ (نقاط إضافية)" : "وش العمل؟ (والشخصية لنقاط إضافية)"} autoFocus />
            <button className="btn-primary h-12">خمّن</button>
          </form>
        )}
      </div>
    );
  }

  if ((view.phase === "draw_vote" || view.phase === "finished") && d.gallery)
    return (
      <div className="space-y-3">
        <p className="text-center font-display text-2xl">{view.phase === "draw_vote" ? "صوّتوا: أفضل رسمة، وأغبى رسمة" : "المعرض"}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {d.gallery.map((g) => (
            <div key={g.id} className="space-y-3 rounded-md border border-line bg-surface p-3">
              <div className="grid grid-cols-2 gap-2">
                <img src={g.png} alt="" className="paper aspect-[4/3] w-full rounded-sm object-contain p-1" />
                <img src={g.original} alt="" className="aspect-[4/3] w-full rounded-sm bg-black object-contain" />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>
                  <b>{name(g.by)}</b> رسم «{L(g)}»
                </span>
                <a className="btn-quiet h-8 border border-line" href={g.png} download={`drawing-${g.id}.png`}>
                  <Icon name="Download" size={14} /> PNG
                </a>
              </div>
              {view.phase === "draw_vote" && g.by !== view.me ? (
                <div className="flex gap-2">
                  <button className={`toggle ${d.myVotes?.best === g.id ? "toggle-on" : ""}`} onClick={() => act({ type: "draw_vote", drawingId: g.id, kind: "best" })}>
                    <Icon name="Trophy" size={14} /> أفضل رسمة
                  </button>
                  <button className={`toggle ${d.myVotes?.funny === g.id ? "toggle-on" : ""}`} onClick={() => act({ type: "draw_vote", drawingId: g.id, kind: "funny" })}>
                    <Icon name="Sparkles" size={14} /> أغبى رسمة
                  </button>
                </div>
              ) : (
                view.phase === "finished" && (
                  <div className="num flex gap-4 text-sm text-muted">
                    <span className="flex items-center gap-1"><Icon name="Trophy" size={14} /> {g.votesBest}</span>
                    <span className="flex items-center gap-1"><Icon name="Sparkles" size={14} /> {g.votesFunny}</span>
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
