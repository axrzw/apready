"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { MODES } from "@gtw/core/questions";
import { useRoom, type View } from "./useRoom";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { Icon } from "@/lib/icons";
import { unlockAudio } from "@/lib/sound";
import QuestionView from "./QuestionView";
import Scoreboard from "./Scoreboard";
import Timer from "./Timer";
import Chat from "./Chat";
import SettingsForm from "./SettingsForm";
import DescriberView from "./DescriberView";
import DrawerView from "./DrawerView";
import { Avatar, CountUp, ErrorNote, Skeleton } from "./ui";

type Act = (a: Record<string, unknown>) => Promise<unknown>;

export default function RoomClient({ code, lang }: { code: string; lang: Lang }) {
  const { view, error, act, now, setError } = useRoom(code);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      setReady(sessionStorage.getItem("gtw-ready") === "1");
    } catch {}
  }, []);

  if (!view)
    return error ? (
      <div className="mx-auto max-w-md space-y-4 pt-12 text-center">
        <Icon name="CircleSlash" size={40} className="mx-auto text-faint" strokeWidth={1.2} />
        <p className="font-display text-xl">{error}</p>
        <Link href="/" className="btn-ghost">
          الرئيسية
        </Link>
      </div>
    ) : (
      <RoomSkeleton />
    );

  // mobile browsers only play sound after a tap: one "ready" tap per session unlocks it
  if (!ready)
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-6 pt-16 text-center">
        <div className="label">ROOM {view.code}</div>
        <h1 className="font-display text-4xl">جاهز؟</h1>
        <p className="text-sm text-muted">اضغط عشان يشتغل الصوت والمؤثرات عندك. شغّل صوت الجوال.</p>
        <button
          className="btn-primary h-14 w-full text-lg"
          onClick={() => {
            unlockAudio();
            try {
              sessionStorage.setItem("gtw-ready", "1");
            } catch {}
            setReady(true);
          }}
        >
          <Icon name="Play" /> جاهز
        </button>
      </div>
    );

  const isHost = view.hostId === view.me;
  const me = view.players.find((p) => p.id === view.me);
  const solo = view.tag === "solo";
  const kind = view.settings.kind;
  const mode = view.question ? MODES.find((m) => m.id === view.question!.mode) : undefined;
  const stage = kind === "describer" || kind === "camera" ? "stage" : "";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <section className={`min-w-0 space-y-5 ${stage}`}>
        {error && <ErrorNote text={error} onClose={() => setError(null)} />}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {!solo && (
            <button className="num flex items-center gap-2 font-display text-lg tracking-[0.25em]" onClick={() => navigator.clipboard?.writeText(`${location.origin}/room/${view.code}`)} title="نسخ رابط الدعوة">
              {view.code}
              <Icon name="Copy" size={14} className="text-faint" />
            </button>
          )}
          {view.tag?.startsWith("daily:") && <span className="label text-accent">DAILY</span>}
          <span className="flex items-center gap-2 text-sm text-muted">
            {mode ? <Icon name={mode.icon} size={16} className="text-accent" /> : <Icon name={kind === "describer" ? "Mic" : kind === "camera" ? "Video" : kind === "drawer" ? "Pen" : "LayoutGrid"} size={16} className="text-accent" />}
            {mode ? mode[lang] : kind === "describer" ? "الواصف" : kind === "camera" ? "اشرح بالكاميرا" : kind === "drawer" ? "الرسّام" : view.settings.modes.length > 1 ? "Mix" : MODES.find((m) => m.id === view.settings.modes[0])?.[lang]}
          </span>
          {view.total > 0 && kind === "guess" && (
            <span className="num ms-auto text-sm text-faint">
              <span className="text-text">{String(view.index + 1).padStart(2, "0")}</span> / {String(view.total).padStart(2, "0")}
            </span>
          )}
        </div>

        {view.phase !== "lobby" && view.phase !== "finished" && !view.paused && <Timer start={view.phaseStartedAt} end={view.phaseEndsAt} now={now} />}
        {view.paused && (
          <div className="flex items-center justify-between rounded-md border border-accent/40 bg-accent/10 px-4 py-3">
            <span className="flex items-center gap-2">
              <Icon name="Pause" size={18} className="text-accent" /> موقوف مؤقتاً
            </span>
            {isHost && (
              <button className="btn-primary h-9" onClick={() => act({ type: "resume" })}>
                <Icon name="Play" size={16} /> كمّل
              </button>
            )}
          </div>
        )}
        {me?.spectator && view.phase !== "lobby" && (
          <div className="flex items-center justify-between rounded-md border border-line bg-surface px-4 py-3 text-sm">
            <span className="flex items-center gap-2 text-muted">
              <Icon name="Eye" size={16} /> تتفرج على الجولة الحالية
            </span>
            <button className="btn-ghost h-9" onClick={() => act({ type: "play" })}>
              انضم كلاعب
            </button>
          </div>
        )}

        {view.phase === "lobby" && <Lobby view={view} act={act} lang={lang} isHost={isHost} />}
        {(view.phase === "question" || view.phase === "reveal") && view.question && <QuestionView view={view} act={act} now={now} lang={lang} />}
        {(kind === "describer" || kind === "camera") && (view.phase.startsWith("describe") || view.phase.startsWith("camera")) && <DescriberView view={view} act={act} lang={lang} />}
        {kind === "drawer" && (view.phase.startsWith("draw") || view.phase === "finished") && <DrawerView view={view} act={act} lang={lang} />}
        {view.phase === "finished" && <Finished view={view} act={act} lang={lang} isHost={isHost} />}

        {isHost && (view.phase === "question" || view.phase === "reveal") && (
          <div className="flex justify-end gap-2">
            {!view.paused && (
              <button className="btn-quiet border border-line" onClick={() => act({ type: "pause" })}>
                <Icon name="Pause" size={16} /> إيقاف مؤقت
              </button>
            )}
            <button className="btn-quiet border border-line" onClick={() => act({ type: "skip" })}>
              <Icon name="SkipForward" size={16} className="rtl:-scale-x-100" />
              {view.phase === "reveal" ? t(lang, "next") : t(lang, "skip")}
            </button>
          </div>
        )}
      </section>
      <aside className="space-y-4">
        <div className="panel p-3">
          <div className="label mb-2 px-2">{t(lang, "players")}</div>
          <Scoreboard view={view} act={act} />
        </div>
        {!solo && (
          <div className="panel p-3">
            <Chat view={view} onSend={(text) => act({ type: "chat", text })} placeholder={kind === "guess" ? "سوالف" : "خمّن هنا"} />
          </div>
        )}
      </aside>
    </div>
  );
}

function RoomSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]" aria-busy>
      <div className="space-y-5">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-[3px] w-full" />
        <Skeleton className="mx-auto h-8 w-2/3" />
        <Skeleton className="mx-auto aspect-[2/3] w-64" />
        <Skeleton className="mx-auto h-12 w-full max-w-xl" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
    </div>
  );
}

function Lobby({ view, act, lang, isHost }: { view: View; act: Act; lang: Lang; isHost: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-6">
      {view.tag !== "solo" && (
        <div className="border-y border-line py-8 text-center">
          <div className="label">INVITE CODE</div>
          <div className="num my-3 font-display text-6xl tracking-[0.3em] text-accent sm:text-7xl">{view.code}</div>
          <button
            className="btn-ghost h-9"
            onClick={() => {
              void navigator.clipboard?.writeText(`${location.origin}/room/${view.code}`);
              setCopied(true);
            }}
          >
            <Icon name={copied ? "Check" : "Copy"} size={16} />
            {copied ? "انتسخ الرابط" : "انسخ رابط الدعوة"}
          </button>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {view.players.map((p) => (
              <motion.div key={p.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 text-sm">
                <Avatar name={p.name} color={p.color} icon={p.avatar} size={28} />
                {p.name}
              </motion.div>
            ))}
          </div>
        </div>
      )}
      {isHost ? (
        <SettingsForm
          initial={view.settings}
          submitLabel={t(lang, "start")}
          onSubmit={async (settings) => {
            await act({ type: "settings", settings });
            await act({ type: "start" });
          }}
          lang={lang}
        />
      ) : (
        <p className="py-6 text-center text-muted">{t(lang, "waitingHost")}</p>
      )}
    </div>
  );
}

function Finished({ view, act, lang, isHost }: { view: View; act: Act; lang: Lang; isHost: boolean }) {
  const podium = [view.players[1], view.players[0], view.players[2]];
  const heights = ["h-20", "h-28", "h-14"];
  return (
    <div className="space-y-8 border-y border-line py-10 text-center">
      <div>
        <div className="label">FIN</div>
        <h2 className="mt-2 font-display text-4xl">{t(lang, "finished")}</h2>
      </div>
      <div className="flex items-end justify-center gap-3 sm:gap-6">
        {podium.map((p, i) =>
          p ? (
            <motion.div key={p.id} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: [0.35, 0.6, 0.15][i], type: "spring", stiffness: 200, damping: 22 }} className="flex w-24 flex-col items-center gap-2 sm:w-32">
              <Avatar name={p.name} color={p.color} icon={p.avatar} size={i === 1 ? 52 : 40} />
              <span className="max-w-full truncate text-sm">{p.name}</span>
              <CountUp value={p.score} className="font-display text-xl text-accent" />
              <div className={`w-full rounded-t-sm border border-b-0 border-line ${i === 1 ? "bg-accent/15" : "bg-surface"} ${heights[i]} grid place-items-center`}>
                <span className="num font-display text-2xl text-faint">{[2, 1, 3][i]}</span>
              </div>
            </motion.div>
          ) : null,
        )}
      </div>
      <div className="flex justify-center gap-2">
        {isHost && view.tag !== "solo" && !view.tag?.startsWith("daily:") && (
          <button className="btn-primary" onClick={() => act({ type: "lobby" })}>
            <Icon name="RotateCcw" size={16} />
            {t(lang, "playAgain")}
          </button>
        )}
        {view.tag === "solo" && (
          <Link className="btn-primary" href="/play">
            <Icon name="RotateCcw" size={16} />
            {t(lang, "playAgain")}
          </Link>
        )}
        <Link className="btn-ghost" href="/">
          الرئيسية
        </Link>
      </div>
    </div>
  );
}
