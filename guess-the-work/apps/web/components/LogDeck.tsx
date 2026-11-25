"use client";
import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import type { Index, Suggestion } from "@gtw/core/autocomplete";
import type { Lang } from "@/lib/i18n";
import { Icon } from "@/lib/icons";
import { loadIndex, suggest } from "@/lib/autocomplete-client";
import { Empty, Skeleton } from "./ui";

type Card = { id: string; title: string; titleAr?: string; year?: number; category: string; poster: string | null; friends: number };
type Status = "seen" | "watching" | "dropped" | "not_seen";

async function log(workId: string, status: Status | null, rating?: number) {
  await fetch("/api/watch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workId, status, rating }) });
}

/** Cards one by one: swipe right = seen, left = not seen, up = skip. Optional rating out of 10. */
export default function LogDeck({ lang }: { lang: Lang }) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const load = useCallback(async () => setCards(await (await fetch("/api/watch/next?n=15")).json()), []);
  useEffect(() => void load(), [load]);
  const top = cards?.[0];
  const next = async (status: Status | null) => {
    if (!top) return;
    if (status) {
      await log(top.id, status, rating ?? undefined);
      setCount((c) => c + 1);
    }
    setRating(null);
    setCards((c) => {
      const rest = (c ?? []).slice(1);
      if (rest.length < 3) void fetch("/api/watch/next?n=15").then((r) => r.json()).then((more: Card[]) => setCards((cur) => [...(cur ?? []), ...more.filter((m) => !(cur ?? []).some((x) => x.id === m.id))]));
      return rest;
    });
  };
  const L = (c: Card) => (lang === "ar" ? c.titleAr || c.title : c.title);

  return (
    <div className="space-y-6">
      <QuickAdd lang={lang} onAdded={() => setCount((c) => c + 1)} />
      {!cards ? (
        <Skeleton className="mx-auto aspect-[2/3] w-full max-w-xs" />
      ) : !top ? (
        <Empty icon="Check" title="خلصت البطاقات" text="سجّلت كل اللي عندنا لك الحين." action={<button className="btn-ghost" onClick={load}>هات غيرها</button>} />
      ) : (
        <>
          <div className="relative mx-auto aspect-[2/3] w-full max-w-xs">
            <AnimatePresence>
              {cards.slice(0, 2).reverse().map((c) => (
                <SwipeCard key={c.id} card={c} top={c.id === top.id} title={L(c)} onSwipe={next} />
              ))}
            </AnimatePresence>
          </div>
          <div className="space-y-2">
            <div className="label text-center">تقييمك (اختياري)</div>
            <div className="grid grid-cols-10 gap-1" dir="ltr">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button key={n} className={`num h-9 rounded-sm border text-sm transition-colors ${rating === n ? "border-accent bg-accent text-accentInk" : "border-line text-muted hover:text-text"}`} onClick={() => setRating(rating === n ? null : n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-primary" onClick={() => next("seen")}>
              <Icon name="Check" size={18} /> شفته كامل
            </button>
            <button className="btn-ghost" onClick={() => next("not_seen")}>
              <Icon name="X" size={18} /> ما شفته
            </button>
            <button className="btn-ghost" onClick={() => next("watching")}>
              <Icon name="Play" size={18} /> أتابعه
            </button>
            <button className="btn-ghost" onClick={() => next("dropped")}>
              <Icon name="CircleSlash" size={18} /> تركته
            </button>
          </div>
          <button className="btn-quiet mx-auto flex" onClick={() => next(null)}>
            تخطي
          </button>
          <p className="num text-center text-xs text-faint">سجّلت {count} الحين · اسحب يمين = شفته، يسار = ما شفته، فوق = تخطي</p>
        </>
      )}
    </div>
  );
}

function SwipeCard({ card, top, title, onSwipe }: { card: Card; top: boolean; title: string; onSwipe: (s: Status | null) => void }) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  const seenOpacity = useTransform(x, [20, 120], [0, 1]);
  const notOpacity = useTransform(x, [-120, -20], [1, 0]);
  const end = (_: unknown, info: PanInfo) => {
    if (info.offset.x > 110) onSwipe("seen");
    else if (info.offset.x < -110) onSwipe("not_seen");
    else if (info.offset.y < -110) onSwipe(null);
  };
  return (
    <motion.div
      className="absolute inset-0 touch-none select-none overflow-hidden rounded-md border border-line bg-surface"
      style={{ x, rotate, zIndex: top ? 2 : 1 }}
      drag={top}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      dragElastic={0.9}
      onDragEnd={end}
      initial={{ scale: top ? 1 : 0.95, opacity: 0 }}
      animate={{ scale: top ? 1 : 0.95, opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
    >
      {card.poster && <img src={card.poster} alt="" className="h-full w-full object-cover" draggable={false} />}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-4 pt-16">
        <div className="font-display text-2xl leading-tight">{title}</div>
        <div className="num text-xs text-muted">
          {card.category}
          {card.year ? ` · ${card.year}` : ""}
          {card.friends ? ` · شافه ${card.friends} من الشباب` : ""}
        </div>
      </div>
      <motion.div style={{ opacity: seenOpacity }} className="absolute start-4 top-4 rounded-sm border-2 border-ok px-2 py-1 font-display text-ok">
        شفته
      </motion.div>
      <motion.div style={{ opacity: notOpacity }} className="absolute end-4 top-4 rounded-sm border-2 border-signal px-2 py-1 font-display text-signal">
        ما شفته
      </motion.div>
    </motion.div>
  );
}

/** Quick search over the whole library, then a status and a rating. */
function QuickAdd({ lang, onAdded }: { lang: Lang; onAdded: () => void }) {
  const [idx, setIdx] = useState<Index | null>(null);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [done, setDone] = useState("");
  const sugs = idx && !picked ? suggest(idx, text, 5) : [];
  return (
    <div className="relative space-y-2">
      <input className="field" placeholder="ابحث عن أي عمل وأضفه" value={picked ? (lang === "ar" ? picked.labelAr || picked.label : picked.label) : text} onFocus={() => !idx && void loadIndex("work").then(setIdx)} onChange={(e) => (setPicked(null), setText(e.target.value), setDone(""))} />
      {sugs.length > 0 && (
        <ul className="absolute inset-x-0 top-12 z-20 overflow-hidden rounded-md border border-lineStrong bg-raise shadow-xl">
          {sugs.map((s) => (
            <li key={s.id}>
              <button className="w-full px-3 py-2 text-start text-sm hover:bg-surface2" onClick={() => setPicked(s)} data-bidi>
                {lang === "ar" ? s.labelAr || s.label : s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <div className="flex flex-wrap items-center gap-2">
          <select className="field h-9 w-auto px-2" value={rating ?? ""} onChange={(e) => setRating(e.target.value ? Number(e.target.value) : null)} aria-label="rating">
            <option value="">بدون تقييم</option>
            {Array.from({ length: 10 }, (_, i) => 10 - i).map((n) => (
              <option key={n} value={n}>
                {n}/10
              </option>
            ))}
          </select>
          {(
            [
              ["seen", "شفته"],
              ["watching", "أتابعه"],
              ["dropped", "تركته"],
            ] as const
          ).map(([st, label]) => (
            <button
              key={st}
              className="toggle h-9"
              onClick={async () => {
                await log(picked.id, st, rating ?? undefined);
                setDone(`انضاف: ${picked.label}`);
                setPicked(null);
                setText("");
                setRating(null);
                onAdded();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {done && <p className="text-xs text-ok">{done}</p>}
    </div>
  );
}
