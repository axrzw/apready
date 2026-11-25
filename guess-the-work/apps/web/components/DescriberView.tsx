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
  camera?: boolean;
  cameraStyle?: "mime" | "talk";
  cameraOn?: boolean;
  turnMode?: "camera" | "talk";
  reports?: { id: number; by: string; status: string }[];
}

/** Studio frame: lens corners, REC dot, rule-of-thirds grid. */
function Viewfinder({ children, rec }: { children: React.ReactNode; rec?: boolean }) {
  return (
    <div className="studio relative rounded-md border border-line bg-black/60 p-5">
      {["top-2 start-2 border-t border-s", "top-2 end-2 border-t border-e", "bottom-2 start-2 border-b border-s", "bottom-2 end-2 border-b border-e"].map((c) => (
        <span key={c} className={`pointer-events-none absolute h-5 w-5 border-text/70 ${c}`} />
      ))}
      {rec && (
        <span className="absolute end-4 top-3 flex items-center gap-1.5 text-[11px] font-semibold tracking-label text-signal">
          <motion.span className="h-2 w-2 rounded-full bg-signal" animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
          REC
        </span>
      )}
      {children}
    </div>
  );
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
          <Icon name={d.camera ? "Video" : d.via === "voice" ? "Mic" : "MessageSquare"} size={14} />
          {d.camera ? (d.cameraStyle === "mime" ? "بالكاميرا: تمثيل صامت" : "بالكاميرا: مسموح الكلام بدون الكلمات الممنوعة") : d.via === "voice" ? "صوتياً في الديسكورد" : "كتابة في الشات"}
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


      {(view.phase === "camera_setup" || view.phase === "camera_confirm") &&
        (mine && d.item ? (
          <Viewfinder>
            <div className="grid gap-5 sm:grid-cols-[160px_1fr]">
              <img src={d.item.image} alt="" className="aspect-[2/3] w-full rounded-md object-cover" />
              <div className="space-y-4">
                <div>
                  <div className="label">YOU EXPLAIN · ON CAMERA</div>
                  <div className="mt-1 font-display text-3xl text-accent">{L(d.item)}</div>
                  {d.item.sub && <div className="text-muted">{d.item.sub}</div>}
                </div>
                {view.phase === "camera_setup" ? (
                  <>
                    <p className="text-sm text-muted">شغّل كاميرتك في مكالمة الديسكورد، وبعدها اضغط «الكاميرا جاهزة».</p>
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-primary" onClick={() => act({ type: "camera_ready" })}>
                        <Icon name="Video" size={18} /> الكاميرا جاهزة
                      </button>
                      <button className="btn-ghost" onClick={() => act({ type: "camera_none" })}>
                        <Icon name="VideoOff" size={18} /> ما عندي كاميرا
                      </button>
                    </div>
                  </>
                ) : (
                  <div role="dialog" aria-label="ما عندي كاميرا" className="space-y-3 rounded-md border border-lineStrong bg-raise p-4">
                    <p className="font-display text-lg">بدون كاميرا؟ اختر:</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button className="btn-primary" onClick={() => act({ type: "camera_choice", choice: "talk" })}>
                        <Icon name="Mic" size={18} /> أشرح بالكلام
                      </button>
                      <button className="btn-ghost" onClick={() => act({ type: "camera_choice", choice: "skip" })}>
                        <Icon name="SkipForward" size={18} className="rtl:-scale-x-100" /> تخطَّ دوري
                      </button>
                    </div>
                    <button className="btn-quiet" onClick={() => act({ type: "camera_choice", choice: "back" })}>
                      <Icon name="ArrowRight" size={16} className="ltr:rotate-180" /> رجوع
                    </button>
                    <p className="text-xs text-faint">إذا ما اخترت قبل نهاية الوقت، يتخطى دورك تلقائياً.</p>
                  </div>
                )}
              </div>
            </div>
          </Viewfinder>
        ) : (
          <Viewfinder>
            <p className="py-10 text-center font-display text-2xl">
              {who?.name ?? ""} يجهّز كاميرته
            </p>
          </Viewfinder>
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
          {d.cameraOn ? (
            <Viewfinder rec>
              <p className="py-6 font-display text-2xl">شغّلوا بث {who?.name ?? ""} في الديسكورد</p>
              {d.cameraStyle === "talk" && (
                <button className="btn-quiet mx-auto border border-line" onClick={() => act({ type: "report_violation" })}>
                  <Icon name="Flag" size={14} /> قال كلمة ممنوعة
                </button>
              )}
            </Viewfinder>
          ) : (
            <p className="font-display text-2xl">{d.via === "voice" || d.turnMode === "talk" ? `اسمع ${who?.name ?? ""} في الديسكورد` : `اقرأ وصف ${who?.name ?? ""} في الشات`}</p>
          )}
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

      {view.hostId === view.me && (d.reports ?? []).some((r) => r.status === "open") && (
        <div className="space-y-2 rounded-md border border-signal/40 bg-signal/10 p-3 text-sm">
          {(d.reports ?? [])
            .filter((r) => r.status === "open")
            .map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2">
                <span className="flex-1">{view.players.find((p) => p.id === r.by)?.name} يقول الشارح قال كلمة ممنوعة</span>
                <button className="btn-danger h-8" onClick={() => act({ type: "approve_report", id: r.id, approve: true })}>
                  اعتمد الخصم
                </button>
                <button className="btn-quiet h-8 border border-line" onClick={() => act({ type: "approve_report", id: r.id, approve: false })}>
                  ارفض
                </button>
              </div>
            ))}
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
