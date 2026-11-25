"use client";
import { motion } from "framer-motion";
import { useState } from "react";
import type { Lang } from "@/lib/i18n";
import { Icon } from "@/lib/icons";
import { play } from "@/lib/sound";
import type { View } from "./useRoom";

interface Item {
  title: string;
  titleAr?: string;
  sub?: string;
  image: string;
}
interface DV {
  describerId?: string;
  turn: number;
  totalTurns: number;
  skipsLeft?: number;
  offered?: Item[];
  item?: Item & { forbidden: string[] };
  reveal?: Item;
  guessed: Record<string, number>;
  penalty: number;
  via: "voice" | "chat";
}

/** Stage light: the item sits in a spotlight, everything else is dark. */
export default function DescriberView({ view, act, lang }: { view: View; act: (a: Record<string, unknown>) => Promise<unknown>; lang: Lang }) {
  const d = view.party as DV | undefined;
  const [guess, setGuess] = useState("");
  if (!d) return null;
  const mine = d.describerId === view.me;
  const who = view.players.find((p) => p.id === d.describerId);
  const L = (x: { title: string; titleAr?: string }) => (lang === "ar" ? x.titleAr || x.title : x.title);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className="num label">
          TURN {d.turn + 1} / {d.totalTurns}
        </span>
        <span>
          الواصف: <b style={{ color: who?.color }}>{who?.name ?? "؟"}</b>
        </span>
        <span className="flex items-center gap-1.5">
          <Icon name={d.via === "voice" ? "Mic" : "MessageSquare"} size={14} />
          {d.via === "voice" ? "صوتياً في الديسكورد" : "كتابة في الشات"}
        </span>
      </div>

      {view.phase === "describe_choose" &&
        (mine && d.offered?.length ? (
          <div className="space-y-3">
            <p className="text-center font-display text-xl">اختر وش بتوصف. تشوفه أنت بس.</p>
            <div className="grid grid-cols-2 gap-4">
              {d.offered.map((o, i) => (
                <button key={i} className="group space-y-2 text-start" onClick={() => act({ type: "describe_choose", index: i })}>
                  <img src={o.image} alt="" className="aspect-[2/3] w-full rounded-md border border-line object-cover transition group-hover:border-accent" />
                  <div className="font-display text-lg leading-tight">{L(o)}</div>
                  {o.sub && <div className="text-xs text-muted">{o.sub}</div>}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="py-10 text-center text-muted">{mine ? "نجهّز لك العناصر" : `${who?.name ?? ""} يختار`}</p>
        ))}

      {view.phase === "describe_turn" && mine && d.item && (
        <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
          <div className="relative">
            <div className="absolute -inset-6 -z-10 rounded-full bg-accent/10 blur-2xl" />
            <img src={d.item.image} alt="" className="aspect-[2/3] w-full rounded-md object-cover" />
          </div>
          <div className="space-y-4">
            <div>
              <div className="label">YOU DESCRIBE</div>
              <div className="mt-1 font-display text-3xl text-accent">{L(d.item)}</div>
              {d.item.sub && <div className="text-muted">{d.item.sub}</div>}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-signal">
                <Icon name="CircleSlash" size={16} /> كلمات ممنوعة (تنحجب وتخصم)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {d.item.forbidden.map((f) => (
                  <span key={f} className="rounded-sm border border-signal/30 px-2 py-0.5 text-xs text-text/80 line-through decoration-signal/60">
                    {f}
                  </span>
                ))}
              </div>
              {d.penalty > 0 && <div className="num text-sm text-signal">الخصم: {d.penalty}</div>}
            </div>
            {!!d.skipsLeft && (
              <button className="btn-ghost h-9" onClick={() => act({ type: "describe_skip" })}>
                <Icon name="SkipForward" size={16} className="rtl:-scale-x-100" /> تخطي (مرة وحدة)
              </button>
            )}
          </div>
        </div>
      )}

      {view.phase === "describe_turn" && !mine && (
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <p className="font-display text-2xl">{d.via === "voice" ? `اسمع ${who?.name ?? ""} في الديسكورد` : `اقرأ وصف ${who?.name ?? ""} في الشات`}</p>
          {d.guessed[view.me] === 1 ? (
            <p className="flex items-center justify-center gap-2 text-ok">
              <Icon name="Check" /> عرفتها
            </p>
          ) : (
            <>
              {!!d.guessed[view.me] && <p className="text-sm text-accent">عرفت العمل. جرّب اسم الشخصية.</p>}
              <form
                className="flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!guess.trim()) return;
                  const r = (await act({ type: "answer", submission: { text: guess } })) as { correct?: boolean } | null;
                  play(r?.correct ? "correct" : "wrong");
                  setGuess("");
                }}
              >
                <input className="field h-12 text-base" value={guess} onChange={(e) => setGuess(e.target.value)} placeholder="تخمينك" autoFocus autoComplete="off" />
                <button className="btn-primary h-12">خمّن</button>
              </form>
            </>
          )}
        </div>
      )}

      {view.phase === "describe_reveal" && d.reveal && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid items-center gap-5 sm:grid-cols-[160px_1fr]">
          <img src={d.reveal.image} alt="" className="mx-auto aspect-[2/3] w-40 rounded-md object-cover" />
          <div className="space-y-2">
            <div className="label">IT WAS</div>
            <div className="font-display text-3xl text-accent">{L(d.reveal)}</div>
            {d.reveal.sub && <div className="text-muted">{d.reveal.sub}</div>}
            <div className="text-sm text-muted">
              عرفوها: {Object.keys(d.guessed).map((id) => view.players.find((p) => p.id === id)?.name).join("، ") || "ولا أحد"}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
