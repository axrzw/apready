"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { stepsFor } from "@gtw/core/pacing";
import type { View } from "./useRoom";
import { Icon } from "@/lib/icons";

type Act = (a: Record<string, unknown>) => Promise<unknown>;

const isQuestions = (v: View) => ["guess", "social", "pack"].includes(v.settings.kind);
const unit = (v: View, n: number) => (isQuestions(v) ? (n === 1 ? "سؤال" : n <= 10 ? "أسئلة" : "سؤال") : n === 1 ? "جولة" : n <= 10 ? "جولات" : "جولة");

/** «زد +5» «زد +10» and a custom amount. */
function ExtendButtons({ view, act, big }: { view: View; act: Act; big?: boolean }) {
  const [custom, setCustom] = useState("");
  const [a, b] = stepsFor(view.settings.kind);
  const cls = big ? "btn-primary h-12" : "btn-quiet border border-line";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {[a, b].map((n, i) => (
        <button key={n} className={i === 0 ? cls : big ? "btn-ghost h-12" : cls} onClick={() => act({ type: "extend", n })}>
          <Icon name="Plus" size={16} /> زد {n} {unit(view, n)}
        </button>
      ))}
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(custom);
          if (n > 0) void act({ type: "extend", n }).then(() => setCustom(""));
        }}
      >
        <input className={`field num w-20 ${big ? "h-12" : "h-9"}`} inputMode="numeric" placeholder="كم؟" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 2))} aria-label="عدد مخصص" />
        <button className={big ? "btn-ghost h-12" : "btn-quiet border border-line"} disabled={!custom}>
          زد
        </button>
      </form>
    </div>
  );
}

/** The host's in-game controls: pause, skip, «زد», time, remaining, «خلاص». */
export function HostBar({ view, act, nextLabel, skipLabel }: { view: View; act: Act; nextLabel: string; skipLabel: string }) {
  const [open, setOpen] = useState(false);
  const [sec, setSec] = useState("");
  const [left, setLeft] = useState("");
  const q = isQuestions(view);
  const last = q ? view.total > 0 && view.index + 1 >= view.total : false;
  const remaining = q ? Math.max(0, view.total - view.index - 1) : undefined;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-2">
        {last && !view.settings.pace?.open && view.settings.kind !== "pack" && (
          <span className="me-auto flex items-center gap-2 text-sm text-accent">
            <Icon name="Flag" size={16} /> آخر سؤال
          </span>
        )}
        {view.preparing && (
          <span className="me-auto flex items-center gap-2 text-sm text-muted">
            <Icon name="Timer" size={16} /> نجهّز أسئلة زيادة
          </span>
        )}
        {!view.paused && (
          <button className="btn-quiet border border-line" onClick={() => act({ type: "pause" })}>
            <Icon name="Pause" size={16} /> إيقاف مؤقت
          </button>
        )}
        {q && (
          <button className="btn-quiet border border-line" onClick={() => act({ type: "skip" })}>
            <Icon name="SkipForward" size={16} className="rtl:-scale-x-100" />
            {view.phase === "reveal" ? nextLabel : skipLabel}
          </button>
        )}
        <button className={`btn-quiet border ${open ? "border-accent text-accent" : "border-line"}`} onClick={() => setOpen((x) => !x)} aria-expanded={open}>
          <Icon name="SlidersHorizontal" size={16} /> تحكّم
        </button>
      </div>
      {open && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="panel space-y-4 p-4">
          {view.settings.kind !== "pack" && (
            <div className="space-y-2">
              <div className="label">زد</div>
              <ExtendButtons view={view} act={act} />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <form
              className="space-y-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (Number(sec) > 0) void act({ type: "adjust", sec: Number(sec) }).then(() => setSec(""));
              }}
            >
              <span className="label">{q ? "ثواني السؤال" : view.settings.kind === "drawer" ? "ثواني الرسم" : "ثواني الدور"}</span>
              <div className="flex gap-2">
                <input className="field num h-9" inputMode="numeric" placeholder={String(q ? view.settings.timeLimitSec : view.settings.kind === "drawer" ? view.settings.draw.drawSec : view.settings.describe.turnSec)} value={sec} onChange={(e) => setSec(e.target.value.replace(/\D/g, "").slice(0, 3))} />
                <button className="btn-quiet border border-line" disabled={!sec}>
                  غيّر
                </button>
              </div>
            </form>
            <form
              className="space-y-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (left !== "") void act({ type: "adjust", remaining: Number(left) }).then(() => setLeft(""));
              }}
            >
              <span className="label">{q ? "الأسئلة الباقية" : view.settings.kind === "drawer" ? "الجولات الباقية" : "الأدوار الباقية"}</span>
              <div className="flex gap-2">
                <input className="field num h-9" inputMode="numeric" placeholder={remaining !== undefined ? String(remaining) : ""} value={left} onChange={(e) => setLeft(e.target.value.replace(/\D/g, "").slice(0, 2))} />
                <button className="btn-quiet border border-line" disabled={left === ""}>
                  غيّر
                </button>
              </div>
            </form>
          </div>
          <button className="btn-ghost w-full border-signal/40 text-signal" onClick={() => act({ type: "end" })}>
            <Icon name="Flag" size={16} /> خلاص، للملخص
          </button>
        </motion.div>
      )}
    </div>
  );
}

/** After the planned length: the host picks «زد» / new round / «خلاص»; or everybody votes. */
export function EndingScreen({ view, act, isHost }: { view: View; act: Act; isHost: boolean }) {
  const e = view.ending;
  const vote = view.settings.pace?.extendVote;
  const me = view.players.find((p) => p.id === view.me);
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 border-y border-line py-10 text-center">
      <div>
        <div className="label">THE END</div>
        <h2 className="mt-2 font-display text-4xl">نكمّل ولا خلاص؟</h2>
        <p className="mt-2 text-sm text-muted">{e?.extending ? "نجهّز الأسئلة الجديدة، لحظة" : vote ? "صوّتوا: الأغلبية تقرر. بدون أغلبية تروح للملخص." : isHost ? "اختر، وإلا تروح للملخص لما يخلص الوقت." : "المضيف يقرر."}</p>
      </div>
      {vote && e && !e.extending && !me?.spectator && (
        <div className="mx-auto flex max-w-sm gap-2">
          <button className={`h-14 flex-1 rounded-md border text-lg ${e.myVote === true ? "border-accent bg-accent/15 text-accent" : "border-line"}`} onClick={() => act({ type: "vote_extend", yes: true })}>
            <span className="flex items-center justify-center gap-2">
              <Icon name="Plus" size={18} /> زد <span className="num text-sm text-muted">{e.yes}</span>
            </span>
          </button>
          <button className={`h-14 flex-1 rounded-md border text-lg ${e.myVote === false ? "border-accent bg-accent/15 text-accent" : "border-line"}`} onClick={() => act({ type: "vote_extend", yes: false })}>
            <span className="flex items-center justify-center gap-2">
              <Icon name="Flag" size={18} /> خلاص <span className="num text-sm text-muted">{e.no}</span>
            </span>
          </button>
        </div>
      )}
      {isHost && !e?.extending && (
        <div className="mx-auto flex max-w-xl flex-col items-center gap-3">
          {view.settings.kind !== "pack" && <ExtendButtons view={view} act={act} big />}
          <div className="flex flex-wrap justify-center gap-2">
            {view.settings.kind !== "pack" && (
              <button className="btn-ghost" onClick={() => act({ type: "new_round" })}>
                <Icon name="RotateCcw" size={16} /> جولة جديدة بنفس الإعدادات
              </button>
            )}
            <button className="btn-ghost" onClick={() => act({ type: "end" })}>
              <Icon name="Flag" size={16} /> خلاص، للملخص
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

/** Anybody can leave mid-game. */
export function LeaveButton({ act }: { act: Act }) {
  const [sure, setSure] = useState(false);
  const router = useRouter();
  return sure ? (
    <span className="flex items-center gap-2 text-sm">
      متأكد؟
      <button
        className="btn-quiet border border-signal/40 text-signal"
        onClick={async () => {
          await act({ type: "leave" });
          router.push("/");
        }}
      >
        إيه، اطلع
      </button>
      <button className="btn-quiet" onClick={() => setSure(false)}>
        لا
      </button>
    </span>
  ) : (
    <button className="btn-quiet text-sm text-muted" onClick={() => setSure(true)}>
      <Icon name="LogOut" size={14} className="rtl:-scale-x-100" /> اطلع من اللعبة
    </button>
  );
}
