"use client";
import Link from "next/link";
import { useRoom, type View } from "./useRoom";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import QuestionView from "./QuestionView";
import Scoreboard from "./Scoreboard";
import Timer from "./Timer";
import Chat from "./Chat";
import SettingsForm from "./SettingsForm";
import DescriberView from "./DescriberView";
import DrawerView from "./DrawerView";
import { MODES } from "@gtw/core/questions";

export default function RoomClient({ code, lang }: { code: string; lang: Lang }) {
  const { view, error, act, now, setError } = useRoom(code);
  if (!view)
    return (
      <div className="mt-20 text-center text-zinc-400">
        {error ? (
          <>
            <p className="text-rose-300">{error}</p>
            <Link href="/" className="btn-ghost mt-4">
              رجوع
            </Link>
          </>
        ) : (
          "…"
        )}
      </div>
    );
  const isHost = view.hostId === view.me;
  const solo = view.tag === "solo";
  const kind = view.settings.kind;
  const modeName = (id: string) => MODES.find((m) => m.id === id)?.[lang] ?? id;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <section className="space-y-4">
        {error && (
          <div className="flex items-center justify-between rounded-xl bg-rose-500/15 p-3 text-rose-300">
            {error}
            <button onClick={() => setError(null)}>✕</button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
          {!solo && (
            <span className="chip">
              {t(lang, "code")}: <b className="font-mono text-lg tracking-widest text-white">{view.code}</b>
            </span>
          )}
          {view.tag?.startsWith("daily:") && <span className="chip chip-on">{t(lang, "daily")}</span>}
          <span>{kind === "guess" ? (view.settings.modes.length > 1 ? `Mix: ${view.settings.modes.length} أطوار` : modeName(view.settings.modes[0])) : kind === "describer" ? "🎙️ الواصف" : "🎨 الرسّام"}</span>
          {view.question && (
            <span className="chip">
              {MODES.find((m) => m.id === view.question!.mode)?.icon} {modeName(view.question.mode)}
            </span>
          )}
          {view.total > 0 && kind === "guess" && (
            <span className="ms-auto">
              {view.index + 1} / {view.total}
            </span>
          )}
        </div>

        {view.phase !== "lobby" && view.phase !== "finished" && <Timer start={view.phaseStartedAt} end={view.phaseEndsAt} now={now} />}

        {view.phase === "lobby" && <Lobby view={view} act={act} lang={lang} isHost={isHost} />}
        {(view.phase === "question" || view.phase === "reveal") && view.question && <QuestionView view={view} act={act} now={now} lang={lang} />}
        {kind === "describer" && view.phase.startsWith("describe") && <DescriberView view={view} act={act} lang={lang} />}
        {kind === "drawer" && (view.phase.startsWith("draw") || view.phase === "finished") && <DrawerView view={view} act={act} lang={lang} />}
        {view.phase === "finished" && <Finished view={view} act={act} lang={lang} isHost={isHost} />}

        {isHost && (view.phase === "question" || view.phase === "reveal") && (
          <button className="btn-ghost" onClick={() => act({ type: "skip" })}>
            ⏭ {view.phase === "reveal" ? t(lang, "next") : t(lang, "skip")}
          </button>
        )}
      </section>
      <aside className="space-y-4">
        <div className="card">
          <h3 className="mb-2 font-bold">{t(lang, "players")}</h3>
          <Scoreboard view={view} />
        </div>
        {!solo && (
          <div className="card">
            <Chat view={view} onSend={(text) => act({ type: "chat", text })} placeholder={kind === "guess" ? "سوالف…" : "خمّن هنا…"} />
          </div>
        )}
      </aside>
    </div>
  );
}

function Lobby({ view, act, lang, isHost }: { view: View; act: (a: Record<string, unknown>) => Promise<unknown>; lang: Lang; isHost: boolean }) {
  return (
    <div className="space-y-4">
      <div className="card text-center">
        <p className="text-zinc-400">شارك الرمز مع الشباب في الديسكورد:</p>
        <p className="my-2 font-mono text-5xl font-black tracking-[0.3em] text-brand-400">{view.code}</p>
        <button className="chip" onClick={() => navigator.clipboard.writeText(`${location.origin}/room/${view.code}`)}>
          📋 نسخ الرابط
        </button>
      </div>
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
        <p className="card text-center text-zinc-400">{t(lang, "waitingHost")}</p>
      )}
    </div>
  );
}

function Finished({ view, act, lang, isHost }: { view: View; act: (a: Record<string, unknown>) => Promise<unknown>; lang: Lang; isHost: boolean }) {
  const [first, second, third] = view.players;
  return (
    <div className="card pop space-y-4 text-center">
      <h2 className="text-3xl font-black">{t(lang, "finished")} 🎉</h2>
      <div className="flex items-end justify-center gap-4">
        {[second, first, third].map((p, i) =>
          p ? (
            <div key={p.id} className="flex flex-col items-center">
              <span className="text-3xl">{["🥈", "🥇", "🥉"][i]}</span>
              <span className="font-bold">{p.name}</span>
              <span className="font-mono text-brand-300">{p.score}</span>
              <div className={`mt-1 w-20 rounded-t-lg bg-ink-700 ${["h-16", "h-24", "h-10"][i]}`} />
            </div>
          ) : null,
        )}
      </div>
      <div className="flex justify-center gap-2">
        {isHost && view.tag !== "solo" && !view.tag?.startsWith("daily:") && (
          <button className="btn-primary" onClick={() => act({ type: "lobby" })}>
            {t(lang, "playAgain")}
          </button>
        )}
        {view.tag === "solo" && (
          <Link className="btn-primary" href="/play">
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
