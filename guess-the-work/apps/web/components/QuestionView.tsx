"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { revealStep } from "@gtw/core/effects";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { useTick, type View } from "./useRoom";

type Act = (a: Record<string, unknown>) => Promise<unknown>;

export default function QuestionView({ view, act, now, lang }: { view: View; act: Act; now: () => number; lang: Lang }) {
  useTick(300);
  const q = view.question!;
  const live = view.phase === "question";
  const elapsed = now() - view.phaseStartedAt;
  const duration = (view.phaseEndsAt ?? view.phaseStartedAt) - view.phaseStartedAt;
  const L = (ar?: string, en?: string) => (lang === "ar" ? ar || en : en || ar) ?? "";

  return (
    <div className="space-y-4">
      <h2 className="text-center text-xl font-bold">{lang === "ar" ? q.promptAr : q.promptEn}</h2>

      {q.assets.map((a, i) =>
        a.type === "image" ? (
          <RevealImage key={a.url} url={a.url} step={live ? revealStep(elapsed, duration, a.steps) : a.steps - 1} />
        ) : a.type === "audio" ? (
          <SyncedMedia key={a.url} kind="audio" url={a.url} startAt={view.phaseStartedAt + 1200} now={now} active={live || view.phase === "reveal"} />
        ) : (
          <SyncedMedia key={a.url} kind="video" url={a.url} muted={a.muted} startAt={view.phaseStartedAt + 1200} now={now} active={live || view.phase === "reveal"} />
        ),
      )}

      {q.text && <p className="card whitespace-pre-line leading-loose">{q.text}</p>}

      {q.items && (
        <div className={`grid gap-3 ${q.items.some((x) => x.image) ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-5" : "grid-cols-1 sm:grid-cols-2"}`}>
          {q.items.map((it, i) => {
            const shown = !q.revealItems || !live || i < 1 + Math.floor((elapsed / Math.max(1, duration)) * q.items!.length);
            return (
              <div key={i} className={`card pop flex items-center gap-2 ${shown ? "" : "opacity-30 blur-sm"}`}>
                {it.image && shown && <img src={it.image} alt="" className="h-20 w-14 rounded object-cover" />}
                <span>{shown ? L(it.labelAr, it.label) : "؟؟؟"}</span>
              </div>
            );
          })}
        </div>
      )}

      {live && <AnswerBox view={view} act={act} lang={lang} />}
      {view.hints && view.hints.length > 0 && (
        <ul className="space-y-1 text-sm">
          {view.hints.map((h, i) => (
            <li key={i} className="rounded-lg bg-ink-800 px-3 py-1">
              💡 {lang === "ar" ? h.ar : h.en} <span className="text-xs text-zinc-500">(-{Math.round(h.cost * 100)}%)</span>
            </li>
          ))}
        </ul>
      )}
      {live && !!view.hintsLeft && view.settings.hints.reveal === "request" && !view.myAnswer?.correct && (
        <button className="btn-ghost" onClick={() => act({ type: "hint" })}>
          💡 {t(lang, "hint")} ({view.hintsLeft})
        </button>
      )}
      {view.phase === "reveal" && <Reveal view={view} lang={lang} act={act} />}
    </div>
  );
}

function RevealImage({ url, step }: { url: string; step: number }) {
  // keep the previous step on screen until the next one has loaded
  const [shown, setShown] = useState(`${url}?s=${step}`);
  useEffect(() => {
    const next = `${url}?s=${step}`;
    const img = new Image();
    img.onload = () => setShown(next);
    img.src = next;
  }, [url, step]);
  return (
    <div className="flex justify-center">
      <img src={shown} alt="" className="max-h-[55vh] rounded-2xl border border-ink-700 object-contain shadow-2xl" draggable={false} onContextMenu={(e) => e.preventDefault()} />
    </div>
  );
}

/** Audio / video that starts at the same server moment for everyone. */
function SyncedMedia({ kind, url, startAt, now, active, muted }: { kind: "audio" | "video"; url: string; startAt: number; now: () => number; active: boolean; muted?: boolean }) {
  const ref = useRef<HTMLMediaElement>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const wait = startAt - now();
    const go = () => {
      el.currentTime = Math.max(0, (now() - startAt) / 1000);
      el.play().catch(() => setBlocked(true));
    };
    const tm = setTimeout(go, Math.max(0, wait));
    return () => clearTimeout(tm);
  }, [url, startAt, active, now]);
  return (
    <div className="flex flex-col items-center gap-2">
      {kind === "audio" ? (
        <>
          <div className="text-6xl">🎧</div>
          <audio ref={ref as React.RefObject<HTMLAudioElement>} src={url} preload="auto" controls controlsList="nodownload" />
        </>
      ) : (
        <video ref={ref as React.RefObject<HTMLVideoElement>} src={url} preload="auto" muted={muted} playsInline className="max-h-[50vh] rounded-2xl" controls={false} />
      )}
      {blocked && (
        <button className="btn-primary" onClick={() => ref.current?.play().then(() => setBlocked(false))}>
          ▶ شغّل
        </button>
      )}
    </div>
  );
}

function AnswerBox({ view, act, lang }: { view: View; act: Act; lang: Lang }) {
  const q = view.question!;
  const mine = view.myAnswer;
  const [text, setText] = useState("");
  const [sugs, setSugs] = useState<string[]>([]);
  const [useChoices, setUseChoices] = useState(view.settings.method === "choice");
  const [shake, setShake] = useState(false);
  const [order, setOrder] = useState<string[]>(() => q.choices?.map((c) => c.id) ?? []);
  const kind = ["shadow", "eyes", "character_name", "voice_actor"].includes(q.mode) ? "character" : "work";

  useEffect(() => {
    setText("");
    setUseChoices(view.settings.method === "choice");
    setOrder(q.choices?.map((c) => c.id) ?? []);
  }, [q.id, view.settings.method, q.choices]);

  useEffect(() => {
    if (text.trim().length < 2 || q.mode === "common_link" || q.mode === "song") return setSugs([]);
    const tm = setTimeout(async () => {
      const r = await fetch(`/api/suggest?kind=${kind}&q=${encodeURIComponent(text)}`);
      if (r.ok) setSugs(await r.json());
    }, 200);
    return () => clearTimeout(tm);
  }, [text, kind, q.mode]);

  const send = async (sub: Record<string, unknown>) => {
    const r = (await act({ type: "answer", submission: sub })) as { correct?: boolean; factor?: number } | null;
    if (r && !r.correct && !r.factor) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
    }
    setSugs([]);
  };

  const done = mine && (mine.correct || mine.method === "choice" || q.answerType !== "text");
  if (done)
    return (
      <div className={`card text-center text-lg ${mine.correct ? "text-emerald-300" : mine.factor ? "text-amber-300" : "text-rose-300"}`}>
        {mine.correct ? `✅ ${t(lang, "correct")} +${mine.points}` : mine.factor ? `🟡 ${t(lang, "partial")} +${mine.points}` : `❌ ${t(lang, "wrong")}`}
        <div className="text-sm text-zinc-400">ننتظر الباقين…</div>
      </div>
    );

  if (q.answerType === "order")
    return (
      <div className="space-y-2">
        {order.map((id, i) => {
          const c = q.choices!.find((x) => x.id === id)!;
          return (
            <div key={id} className="card flex items-center gap-2 py-2">
              <span className="w-6 text-zinc-500">{i + 1}</span>
              <span className="flex-1">{lang === "ar" ? c.labelAr || c.label : c.label}</span>
              <button className="btn-ghost px-2 py-1" disabled={i === 0} onClick={() => setOrder(swap(order, i, i - 1))}>
                ▲
              </button>
              <button className="btn-ghost px-2 py-1" disabled={i === order.length - 1} onClick={() => setOrder(swap(order, i, i + 1))}>
                ▼
              </button>
            </div>
          );
        })}
        <button className="btn-primary w-full" onClick={() => send({ order })}>
          {t(lang, "answer")}
        </button>
      </div>
    );

  if (q.answerType === "pick" || (useChoices && q.choices))
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {q.choices!.map((c) => (
          <button key={c.id} className="btn-ghost flex-col py-3 text-base" onClick={() => send({ choice: c.id })}>
            {c.image && <img src={c.image} alt="" className="mb-1 h-32 rounded object-cover" />}
            {lang === "ar" ? c.labelAr || c.label : c.label}
          </button>
        ))}
      </div>
    );

  return (
    <div className="relative space-y-2">
      {mine && !mine.correct && mine.factor > 0 && <p className="text-center text-amber-300">🟡 عرفت العمل (+{mine.points})، تقدر تحاول اسم الشخصية للنقاط الكاملة</p>}
      <form
        className={`flex gap-2 ${shake ? "shake" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) send({ text });
        }}
      >
        <input autoFocus className="input text-lg" value={text} onChange={(e) => setText(e.target.value)} placeholder={t(lang, "typeAnswer")} autoComplete="off" />
        <button className="btn-primary">{t(lang, "answer")}</button>
      </form>
      {sugs.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-ink-600 bg-ink-800 shadow-xl">
          {sugs.map((s) => (
            <li key={s}>
              <button className="w-full px-3 py-2 text-start hover:bg-ink-700" onClick={() => send({ text: s })}>
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
      {view.settings.method === "both" && q.choices && (
        <button className="text-sm text-zinc-400 underline" onClick={() => setUseChoices(true)}>
          {t(lang, "chooseFour")}
        </button>
      )}
      {mine && mine.tries > 0 && <p className="text-sm text-zinc-500">محاولات غلط: {mine.tries}</p>}
    </div>
  );
}

function swap(a: string[], i: number, j: number) {
  const b = [...a];
  [b[i], b[j]] = [b[j], b[i]];
  return b;
}

function Reveal({ view, lang, act }: { view: View; lang: Lang; act: Act }) {
  const r = view.reveal!;
  const mine = r.results.find((x) => x.id === view.me);
  const [reported, setReported] = useState(false);
  const [proposed, setProposed] = useState(false);
  const pending = useMemo(() => (view as unknown as { aliasVote?: AliasVoteView }).aliasVote, [view]);
  return (
    <div className="card pop flex flex-col items-center gap-3 text-center sm:flex-row sm:text-start">
      {r.image && <img src={r.image} alt="" className="h-40 rounded-xl object-cover" />}
      <div className="flex-1 space-y-1">
        <div className="text-sm text-zinc-400">الجواب</div>
        <div className="text-2xl font-black text-brand-300">{lang === "ar" ? r.titleAr || r.title : r.title}</div>
        {r.titleAr && lang === "ar" && <div className="text-zinc-400">{r.title}</div>}
        {r.sub && <div className="text-sm text-zinc-400">{r.sub}</div>}
        {mine && <div className={mine.correct ? "text-emerald-300" : "text-zinc-400"}>{mine.correct ? `+${mine.points}` : mine.points ? `+${mine.points}` : "ولا نقطة"}</div>}
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            className="chip"
            disabled={reported}
            onClick={async () => {
              const reason = prompt("وش الخربان؟ (جواب غلط، صورة ما تفتح، يكشف الجواب…)") ?? "";
              await fetch("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: view.code, questionId: view.question?.id, reason }) });
              setReported(true);
            }}
          >
            🚩 {reported ? "وصل البلاغ" : t(lang, "report")}
          </button>
          {mine && !mine.correct && !proposed && view.players.length > 1 && (
            <button
              className="chip"
              onClick={async () => {
                const text = prompt("وش كتبت؟ الباقين بيصوّتون إذا ينقبل كاسم ثاني للعمل") ?? "";
                if (text.trim()) await act({ type: "alias_propose", text });
                setProposed(true);
              }}
            >
              🙋 {t(lang, "acceptMine")}
            </button>
          )}
          {view.players.length === 1 && mine && !mine.correct && !proposed && (
            <button
              className="chip"
              onClick={async () => {
                const text = prompt("وش كتبت؟ ينحفظ كاقتراح للأدمن") ?? "";
                if (text.trim()) await fetch("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: view.code, questionId: view.question?.id, reason: `اسم بديل مقترح: ${text}` }) });
                setProposed(true);
              }}
            >
              🙋 {t(lang, "acceptMine")}
            </button>
          )}
        </div>
        {pending && <AliasVote vote={pending} view={view} act={act} />}
      </div>
    </div>
  );
}

export interface AliasVoteView {
  by: string;
  text: string;
  yes: number;
  no: number;
  myVote?: boolean;
  status: "open" | "accepted" | "rejected";
}

function AliasVote({ vote, view, act }: { vote: AliasVoteView; view: View; act: Act }) {
  const by = view.players.find((p) => p.id === vote.by)?.name;
  return (
    <div className="mt-2 rounded-xl bg-ink-800 p-3 text-sm">
      {by} يبي «{vote.text}» تنقبل كاسم للجواب. ✅ {vote.yes} · ❌ {vote.no}
      {vote.status === "open" && vote.by !== view.me && vote.myVote === undefined && (
        <span className="ms-2 inline-flex gap-2">
          <button className="chip" onClick={() => act({ type: "alias_vote", yes: true })}>
            نعم
          </button>
          <button className="chip" onClick={() => act({ type: "alias_vote", yes: false })}>
            لا
          </button>
        </span>
      )}
      {vote.status === "accepted" && <span className="ms-2 text-emerald-300">انقبل وانضاف ✔</span>}
      {vote.status === "rejected" && <span className="ms-2 text-rose-300">ما انقبل</span>}
    </div>
  );
}
