"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { revealStep } from "@gtw/core/effects";
import type { Lang } from "@/lib/i18n";
import { t } from "@/lib/i18n";
import { Icon } from "@/lib/icons";
import { play } from "@/lib/sound";
import { useTick, type View } from "./useRoom";
import { CountUp, Waveform } from "./ui";

type Act = (a: Record<string, unknown>) => Promise<unknown>;
const AUDIO_MODES = ["opening", "ending", "ost", "audio_edit", "song"];

export default function QuestionView({ view, act, now, lang }: { view: View; act: Act; now: () => number; lang: Lang }) {
  useTick(300);
  const q = view.question!;
  const live = view.phase === "question";
  const elapsed = now() - view.phaseStartedAt;
  const duration = (view.phaseEndsAt ?? view.phaseStartedAt) - view.phaseStartedAt;
  const L = (ar?: string, en?: string) => (lang === "ar" ? ar || en : en || ar) ?? "";
  const audio = AUDIO_MODES.includes(q.mode);

  return (
    <AnimatePresence mode="wait">
      <motion.div key={q.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.28, ease: "easeOut" }} className="space-y-5">
        <h2 className="text-balance text-center font-display text-2xl leading-snug sm:text-3xl">{lang === "ar" ? q.promptAr : q.promptEn}</h2>

        {q.assets.map((a) =>
          a.type === "image" ? (
            <RevealImage key={a.url} url={a.url} step={live ? revealStep(elapsed, duration, a.steps) : a.steps - 1} steps={a.steps} />
          ) : a.type === "audio" ? (
            <SyncedAudio key={a.url} url={a.url} startAt={view.phaseStartedAt + 1200} now={now} active={live || view.phase === "reveal"} />
          ) : (
            <SyncedVideo key={a.url} url={a.url} muted={a.muted} startAt={view.phaseStartedAt + 1200} now={now} active={live || view.phase === "reveal"} />
          ),
        )}
        {audio && !q.assets.length && <Waveform />}

        {q.text && (
          <article className="panel mx-auto max-w-2xl p-5 text-[15px] leading-8 text-text/90">
            <div className="label mb-2">SCRIPT · الأسماء محجوبة</div>
            <Redacted text={q.text} />
          </article>
        )}

        {q.items && <Items q={q} live={live} elapsed={elapsed} duration={duration} L={L} />}

        {live && <AnswerBox view={view} act={act} lang={lang} />}

        {view.hints && view.hints.length > 0 && (
          <ol className="mx-auto max-w-2xl space-y-1.5">
            {view.hints.map((h, i) => (
              <motion.li key={i} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="flex items-start gap-3 border-s-2 border-accent/60 bg-surface px-3 py-2 text-sm">
                <span className="num text-xs text-faint">{String(i + 1).padStart(2, "0")}</span>
                <span className="flex-1">{lang === "ar" ? h.ar : h.en}</span>
                <span className="num text-xs text-faint">-{Math.round(h.cost * 100)}%</span>
              </motion.li>
            ))}
          </ol>
        )}
        {live && !!view.hintsLeft && view.settings.hints.reveal === "request" && !view.myAnswer?.correct && (
          <div className="text-center">
            <button className="btn-ghost" onClick={() => act({ type: "hint" })}>
              <Icon name="Lightbulb" size={16} />
              {t(lang, "hint")} <span className="num text-faint">({view.hintsLeft})</span>
            </button>
          </div>
        )}
        {view.phase === "reveal" && <Reveal view={view} lang={lang} act={act} />}
      </motion.div>
    </AnimatePresence>
  );
}

function Redacted({ text }: { text: string }) {
  const parts = text.split(/(▇+)/);
  return (
    <p className="whitespace-pre-line">
      {parts.map((p, i) => (p.startsWith("▇") ? <span key={i} className="redact" style={{ width: `${2.2 + (i % 3) * 0.8}em` }} aria-label="محجوب" /> : <span key={i}>{p}</span>))}
    </p>
  );
}

function Items({ q, live, elapsed, duration, L }: { q: NonNullable<View["question"]>; live: boolean; elapsed: number; duration: number; L: (a?: string, b?: string) => string }) {
  const withImages = q.items!.some((x) => x.image);
  const shownCount = !q.revealItems || !live ? q.items!.length : 1 + Math.floor((elapsed / Math.max(1, duration)) * q.items!.length);
  if (withImages)
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {q.items!.map((it, i) => (
          <motion.figure key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="space-y-2">
            {it.image && <img src={it.image} alt="" className="aspect-[2/3] w-full rounded-md border border-line object-cover" />}
            <figcaption className="text-sm leading-snug">{L(it.labelAr, it.label)}</figcaption>
          </motion.figure>
        ))}
      </div>
    );
  return (
    <ul className="mx-auto flex max-w-2xl flex-wrap justify-center gap-2">
      {q.items!.map((it, i) => (
        <motion.li
          key={i}
          initial={false}
          animate={{ opacity: i < shownCount ? 1 : 0.25, filter: i < shownCount ? "blur(0px)" : "blur(4px)" }}
          className="rounded-sm border border-line bg-surface px-3 py-1.5 text-sm"
        >
          <span className="num me-2 text-[11px] text-faint">#{i + 1}</span>
          {i < shownCount ? L(it.labelAr, it.label) : "• • •"}
        </motion.li>
      ))}
    </ul>
  );
}

function RevealImage({ url, step, steps }: { url: string; step: number; steps: number }) {
  // keep the previous step on screen until the next one has loaded, then crossfade
  const [layers, setLayers] = useState<string[]>([`${url}?s=${step}`]);
  useEffect(() => {
    const next = `${url}?s=${step}`;
    const img = new Image();
    img.onload = () => setLayers((l) => (l.at(-1) === next ? l : [...l.slice(-1), next]));
    img.src = next;
  }, [url, step]);
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="crop relative">
        <div className="relative overflow-hidden rounded-md shadow-[0_30px_80px_-40px_rgba(0,0,0,.8)]">
          {layers.map((src, i) => (
            <motion.img
              key={src}
              src={src}
              alt=""
              initial={{ opacity: i === 0 ? 1 : 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4 }}
              className={`max-h-[52dvh] w-auto select-none object-contain ${i === 0 ? "" : "absolute inset-0 h-full w-full"}`}
              draggable={false}
              onContextMenu={(e) => e.preventDefault()}
            />
          ))}
        </div>
      </div>
      {steps > 1 && (
        <div className="flex gap-1" aria-label={`step ${step + 1} of ${steps}`}>
          {Array.from({ length: steps }, (_, i) => (
            <span key={i} className={`h-0.5 w-5 rounded-full transition-colors ${i <= step ? "bg-accent" : "bg-line"}`} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Audio that starts at the same server moment for everyone (clock offset applied). */
function SyncedAudio({ url, startAt, now, active }: { url: string; startAt: number; now: () => number; active: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [vol, setVol] = useState(0.9);
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const go = () => {
      el.currentTime = Math.max(0, (now() - startAt) / 1000);
      el.play().then(() => setPlaying(true), () => setBlocked(true));
    };
    const tm = setTimeout(go, Math.max(0, startAt - now()));
    return () => clearTimeout(tm);
  }, [url, startAt, active, now]);
  useEffect(() => {
    if (ref.current) ref.current.volume = vol;
  }, [vol]);
  return (
    <div className="mx-auto w-full max-w-lg space-y-3 rounded-md border border-line bg-surface px-4 py-5">
      <Waveform playing={playing} />
      <audio ref={ref} src={url} preload="auto" onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
      <div className="flex items-center gap-3">
        {blocked ? (
          <button className="btn-primary h-9" onClick={() => ref.current?.play().then(() => setBlocked(false))}>
            <Icon name="Play" size={16} /> شغّل
          </button>
        ) : (
          <Icon name="Volume2" size={16} className="text-muted" />
        )}
        <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => setVol(Number(e.target.value))} className="w-full accent-[var(--accent)]" aria-label="volume" />
      </div>
    </div>
  );
}

function SyncedVideo({ url, startAt, now, active, muted }: { url: string; startAt: number; now: () => number; active: boolean; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const tm = setTimeout(() => {
      el.currentTime = Math.max(0, (now() - startAt) / 1000);
      void el.play().catch(() => {});
    }, Math.max(0, startAt - now()));
    return () => clearTimeout(tm);
  }, [url, startAt, active, now]);
  return (
    <div className="mx-auto max-w-2xl overflow-hidden rounded-md border border-line bg-black">
      <div className="h-6 bg-black" />
      <video ref={ref} src={url} preload="auto" muted={muted} playsInline className="max-h-[48dvh] w-full" />
      <div className="h-6 bg-black" />
    </div>
  );
}

function AnswerBox({ view, act, lang }: { view: View; act: Act; lang: Lang }) {
  const q = view.question!;
  const mine = view.myAnswer;
  const [text, setText] = useState("");
  const [sugs, setSugs] = useState<string[]>([]);
  const [active, setActive] = useState(-1);
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
      if (r.ok) {
        setSugs(await r.json());
        setActive(-1);
      }
    }, 120);
    return () => clearTimeout(tm);
  }, [text, kind, q.mode]);

  const send = async (sub: Record<string, unknown>) => {
    const r = (await act({ type: "answer", submission: sub })) as { correct?: boolean; factor?: number } | null;
    if (r?.correct) play("correct");
    else if (r && !r.factor) {
      play("wrong");
      setShake(true);
      setTimeout(() => setShake(false), 400);
    }
    setSugs([]);
  };

  const done = mine && (mine.correct || mine.method === "choice" || q.answerType !== "text");
  if (done)
    return (
      <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mx-auto flex max-w-md items-center justify-center gap-3 rounded-md border border-line bg-surface px-4 py-4">
        <Icon name={mine.correct ? "Check" : mine.factor ? "CircleSlash" : "X"} className={mine.correct ? "text-ok" : mine.factor ? "text-accent" : "text-signal"} />
        <span className="font-display text-xl">{mine.correct ? t(lang, "correct") : mine.factor ? t(lang, "partial") : t(lang, "wrong")}</span>
        {mine.points > 0 && <CountUp value={mine.points} className="font-display text-xl text-accent" />}
        <span className="text-sm text-muted">· ننتظر الباقين</span>
      </motion.div>
    );

  if (q.answerType === "order")
    return (
      <div className="mx-auto max-w-xl space-y-2">
        {order.map((id, i) => {
          const c = q.choices!.find((x) => x.id === id)!;
          return (
            <motion.div layout key={id} className="flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2">
              <span className="num w-6 text-sm text-faint">{i + 1}</span>
              <span className="flex-1">{lang === "ar" ? c.labelAr || c.label : c.label}</span>
              <button className="btn-quiet px-2" disabled={i === 0} onClick={() => setOrder(swap(order, i, i - 1))} aria-label="up">
                <Icon name="ChevronUp" />
              </button>
              <button className="btn-quiet px-2" disabled={i === order.length - 1} onClick={() => setOrder(swap(order, i, i + 1))} aria-label="down">
                <Icon name="ChevronDown" />
              </button>
            </motion.div>
          );
        })}
        <button className="btn-primary w-full" onClick={() => send({ order })}>
          {t(lang, "answer")}
        </button>
      </div>
    );

  if (q.answerType === "pick" || (useChoices && q.choices))
    return (
      <div className="mx-auto grid max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {q.choices!.map((c, i) => (
          <button key={c.id} className="group flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 text-start transition-colors hover:border-accent/60" onClick={() => send({ choice: c.id })}>
            {c.image ? <img src={c.image} alt="" className="h-16 w-12 rounded-sm object-cover" /> : <span className="num grid h-7 w-7 place-items-center rounded-sm border border-line text-xs text-faint group-hover:text-accent">{"ABCD"[i]}</span>}
            <span>{lang === "ar" ? c.labelAr || c.label : c.label}</span>
          </button>
        ))}
      </div>
    );

  return (
    <div className="relative mx-auto max-w-xl space-y-2">
      {mine && !mine.correct && mine.factor > 0 && <p className="text-center text-sm text-accent">عرفت العمل (+{mine.points}). جرّب اسم الشخصية للنقاط الكاملة.</p>}
      <form
        className={`flex gap-2 ${shake ? "shake" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (active >= 0 && sugs[active]) return void send({ text: sugs[active] });
          if (text.trim()) void send({ text });
        }}
      >
        <input
          autoFocus
          className="field h-12 text-base"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(sugs.length - 1, a + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(-1, a - 1));
            }
          }}
          placeholder={kind === "character" ? (lang === "ar" ? "اكتب اسم الشخصية" : "Character's name") : q.mode === "song" ? (lang === "ar" ? "اسم الأغنية أو الفنان" : "Song or artist") : q.mode === "common_link" ? (lang === "ar" ? "وش الرابط؟ استوديو، مؤلف، مؤدي، سنة" : "What links them?") : t(lang, "typeAnswer")}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
        />
        <button className="btn-primary h-12 px-4" aria-label={t(lang, "answer")}>
          <Icon name="Send" size={18} className="ltr:rotate-0 rtl:-scale-x-100" />
        </button>
      </form>
      <AnimatePresence>
        {sugs.length > 0 && (
          <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute inset-x-0 top-[52px] z-20 overflow-hidden rounded-md border border-lineStrong bg-raise shadow-xl">
            {sugs.map((s, i) => (
              <li key={s}>
                <button className={`flex w-full items-center gap-2 px-3 py-2.5 text-start text-[15px] ${i === active ? "bg-surface2" : "hover:bg-surface2"}`} onMouseDown={(e) => e.preventDefault()} onClick={() => send({ text: s })}>
                  <Icon name="Search" size={14} className="text-faint" />
                  {s}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      <div className="flex items-center justify-between text-xs text-faint">
        {view.settings.method === "both" && q.choices ? (
          <button className="underline-offset-4 hover:text-text hover:underline" onClick={() => setUseChoices(true)}>
            {t(lang, "chooseFour")}
          </button>
        ) : (
          <span />
        )}
        {mine && mine.tries > 0 && <span className="num">محاولات غلط: {mine.tries}</span>}
      </div>
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
  useEffect(() => play(mine?.correct ? "reveal" : "timeup"), [mine?.correct]);
  const title = lang === "ar" ? r.titleAr || r.title : r.title;
  const pv = view.aliasVote;
  return (
    <div className="relative overflow-hidden rounded-md border border-line bg-black">
      <motion.div className="absolute inset-x-0 top-0 z-10 h-6 bg-black" initial={{ y: -24 }} animate={{ y: 0 }} transition={{ duration: 0.35 }} />
      <motion.div className="absolute inset-x-0 bottom-0 z-10 h-6 bg-black" initial={{ y: 24 }} animate={{ y: 0 }} transition={{ duration: 0.35 }} />
      <div className="relative grid gap-5 bg-surface p-5 pt-10 pb-10 sm:grid-cols-[160px_1fr]">
        {r.image && <motion.img initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6 }} src={r.image} alt="" className="mx-auto aspect-[2/3] w-36 rounded-sm object-cover sm:w-40" />}
        <div className="space-y-3">
          <div className="label">THE ANSWER</div>
          <h3 className="font-display text-3xl leading-tight text-accent sm:text-4xl">
            {[...title].map((ch, i) => (
              <motion.span key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + i * 0.018 }}>
                {ch}
              </motion.span>
            ))}
          </h3>
          {r.titleAr && lang === "ar" && r.title !== r.titleAr && <div className="text-muted">{r.title}</div>}
          {r.sub && <div className="text-sm text-muted">{r.sub}</div>}
          <ul className="space-y-1 pt-2">
            {r.results
              .map((x) => ({ ...x, p: view.players.find((p) => p.id === x.id) }))
              .sort((a, b) => b.points - a.points)
              .map((x) => (
                <li key={x.id} className="flex items-center gap-3 text-sm">
                  <span className="h-2 w-2 rounded-full" style={{ background: x.p?.color ?? "#9c978e" }} />
                  <span className="flex-1">{x.p?.name ?? "؟"}</span>
                  <Icon name={x.correct ? "Check" : x.factor ? "CircleSlash" : "X"} size={14} className={x.correct ? "text-ok" : x.factor ? "text-accent" : "text-faint"} />
                  <span className="num w-14 text-end">{x.points ? <CountUp value={x.points} /> : <span className="text-faint">0</span>}</span>
                </li>
              ))}
          </ul>
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              className="btn-quiet border border-line"
              disabled={reported}
              onClick={async () => {
                const reason = prompt("وش الخربان؟ (جواب غلط، صورة ما تفتح، يكشف الجواب...)") ?? "";
                await fetch("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: view.code, questionId: view.question?.id, reason }) });
                setReported(true);
              }}
            >
              <Icon name="Flag" size={14} />
              {reported ? "وصل البلاغ" : t(lang, "report")}
            </button>
            {mine && !mine.correct && !proposed && (
              <button
                className="btn-quiet border border-line"
                onClick={async () => {
                  const text = prompt(view.players.length > 1 ? "وش كتبت؟ الباقين بيصوّتون إذا ينقبل" : "وش كتبت؟ ينحفظ كاقتراح للأدمن") ?? "";
                  if (text.trim()) {
                    if (view.players.length > 1) await act({ type: "alias_propose", text });
                    else await fetch("/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: view.code, questionId: view.question?.id, reason: `اسم بديل مقترح: ${text}` }) });
                  }
                  setProposed(true);
                }}
              >
                <Icon name="Hand" size={14} />
                {t(lang, "acceptMine")}
              </button>
            )}
          </div>
          {pv && (
            <div className="rounded-sm border border-line bg-surface2 p-3 text-sm">
              {view.players.find((p) => p.id === pv.by)?.name} يبي «{pv.text}» تنقبل كاسم للجواب · <span className="num">{pv.yes}</span> نعم · <span className="num">{pv.no}</span> لا
              {pv.status === "open" && pv.by !== view.me && pv.myVote === undefined && (
                <span className="ms-2 inline-flex gap-2">
                  <button className="toggle h-7" onClick={() => act({ type: "alias_vote", yes: true })}>
                    نعم
                  </button>
                  <button className="toggle h-7" onClick={() => act({ type: "alias_vote", yes: false })}>
                    لا
                  </button>
                </span>
              )}
              {pv.status === "accepted" && <span className="ms-2 text-ok">انقبل وانضاف</span>}
              {pv.status === "rejected" && <span className="ms-2 text-signal">ما انقبل</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
