"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { TIER_ROWS, type Placement, type TierRow } from "@gtw/core/tierlist";
import type { View } from "./useRoom";
import { Icon } from "@/lib/icons";
import { TIER_COLOR, exportBoard, label, type TierItemView } from "@/lib/tier-ui";
import { Avatar } from "./ui";

type Act = (a: Record<string, unknown>) => Promise<unknown>;

interface Result {
  tier: TierRow | null;
  how: string;
  disagree: number;
  opinions: Record<string, TierRow>;
}
interface TV {
  style: "vote" | "discuss" | "solo" | "guess_friend";
  items: TierItemView[];
  from: number;
  board: Record<string, TierRow>;
  current?: TierItemView;
  index: number;
  total: number;
  votes?: number;
  myVote?: TierRow;
  tiebreak?: { average: TierRow | null };
  placement?: { tier: TierRow; by: string; at: number };
  agrees: string[];
  result?: Result;
  myBoard: Record<string, Placement>;
  submitted: string[];
  boards?: Record<string, Record<string, Placement>>;
  results?: Record<string, Result>;
  stats?: { aligned?: { id: string; diff: number }; outlier?: { id: string; diff: number }; disputed?: { id: string; spread: number }; agreed?: { id: string; spread: number }; diffs: Record<string, number> };
  points: Record<string, number>;
  target?: string;
}

const spring = { type: "spring", stiffness: 380, damping: 30 } as const;

/** A tile: poster / character / song (with a private play button). */
export function Tile({ it, size = "sm", ring, onClick, selected }: { it: TierItemView; size?: "sm" | "lg"; ring?: string; onClick?: () => void; selected?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const big = size === "lg";
  return (
    <motion.div
      layout
      layoutId={big ? undefined : `tile-${it.id}`}
      transition={spring}
      className={`group relative shrink-0 overflow-hidden rounded-sm border bg-surface2 ${big ? "w-44 sm:w-56" : "w-12 sm:w-14"} ${selected ? "border-accent ring-2 ring-accent" : "border-line"}`}
      style={ring ? { boxShadow: `0 0 0 2px ${ring}` } : undefined}
      title={label(it)}
      draggable={!!onClick}
      onDragStart={(e) => (e as unknown as React.DragEvent).dataTransfer?.setData("text/plain", it.id)}
    >
      <button type="button" className="block w-full" onClick={onClick} disabled={!onClick} aria-label={label(it)}>
        {it.image ? <img src={it.image} alt="" className="aspect-[2/3] w-full object-cover" draggable={false} /> : <div className="grid aspect-[2/3] w-full place-items-center p-1 text-center text-[10px] leading-tight">{label(it)}</div>}
      </button>
      {it.audio && (
        <>
          <audio ref={audio} src={it.audio} preload="none" onEnded={() => setPlaying(false)} />
          <button
            type="button"
            className={`absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-bg/80 ${big ? "py-2 text-sm" : "py-0.5"}`}
            onClick={() => {
              const a = audio.current;
              if (!a) return;
              if (a.paused) void a.play().then(() => setPlaying(true));
              else {
                a.pause();
                setPlaying(false);
              }
            }}
            aria-label="شغّل"
          >
            <Icon name={playing ? "Pause" : "Headphones"} size={big ? 16 : 12} />
            {big && (playing ? "وقّف" : "اسمع")}
          </button>
        </>
      )}
    </motion.div>
  );
}

/** Rows S..F with the items in them. Optional: tap a row (put the selected item there), rings per item. */
export function Board({ items, board, onRow, rings, compact }: { items: TierItemView[]; board: Record<string, Placement>; onRow?: (t: Placement) => void; rings?: Record<string, string>; compact?: boolean }) {
  const [over, setOver] = useState<string | null>(null);
  const rows: Placement[] = [...TIER_ROWS];
  if (onRow) rows.push("unseen");
  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const mine = items.filter((it) => board[it.id] === r);
        return (
          <div
            key={r}
            className={`flex min-h-[4.5rem] items-stretch overflow-hidden rounded-sm border ${over === r ? "border-accent" : "border-line"} ${compact ? "min-h-[3.25rem]" : ""}`}
            onClick={() => onRow?.(r)}
            onDragOver={(e) => (onRow ? (e.preventDefault(), setOver(r)) : undefined)}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = e.dataTransfer.getData("text/plain");
              if (id && onRow) window.dispatchEvent(new CustomEvent("tier-drop", { detail: { id, tier: r } }));
            }}
            role={onRow ? "button" : undefined}
            aria-label={onRow ? (r === "unseen" ? "ما شفته" : `تير ${r}`) : undefined}
          >
            <div className={`grid shrink-0 place-items-center font-display ${compact ? "w-9 text-xl" : "w-14 text-3xl"} ${r === "unseen" ? "bg-surface text-xs text-muted" : "text-bg"}`} style={r !== "unseen" ? { background: TIER_COLOR[r] } : undefined}>
              {r === "unseen" ? "ما شفته" : r}
            </div>
            <div className="flex flex-1 flex-wrap content-start gap-1 bg-surface/60 p-1">
              {mine.map((it) => (
                <Tile key={it.id} it={it} ring={rings?.[it.id]} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TierButtons({ value, onPick, disabled }: { value?: TierRow; onPick: (t: TierRow) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-6 gap-1.5">
      {TIER_ROWS.map((t) => (
        <motion.button
          key={t}
          whileTap={{ scale: 0.92 }}
          disabled={disabled}
          onClick={() => onPick(t)}
          className={`h-14 rounded-sm font-display text-2xl text-bg transition disabled:opacity-40 ${value === t ? "ring-2 ring-text ring-offset-2 ring-offset-bg" : value ? "opacity-60" : ""}`}
          style={{ background: TIER_COLOR[t] }}
        >
          {t}
        </motion.button>
      ))}
    </div>
  );
}

export default function TierListView({ view, act }: { view: View; act: Act }) {
  const t = view.party as TV | undefined;
  const isHost = view.hostId === view.me;
  const name = (id?: string) => view.players.find((p) => p.id === id)?.name ?? "؟";
  const color = (id?: string) => view.players.find((p) => p.id === id)?.color ?? "#e9b44c";
  const me = view.players.find((p) => p.id === view.me);
  const active = view.players.filter((p) => !p.spectator);
  if (!t) return null;
  const locked = t.items.filter((it) => t.board[it.id]);

  // ---------------------------------------------------------------- collective
  if (view.phase === "tier_item" || view.phase === "tier_tiebreak" || view.phase === "tier_result") {
    const it = t.current;
    return (
      <div className="space-y-5">
        <p className="num text-center text-sm text-muted">
          {t.style === "vote" ? "تصويت سري" : "نقاش حر"} · {t.index + 1} من {t.total}
        </p>
        <LayoutGroup>
          {it && (
            <div className="flex flex-col items-center gap-3">
              <Tile it={it} size="lg" />
              <div className="text-center">
                <div className="font-display text-2xl">{label(it)}</div>
                {it.sub && <div className="text-xs text-muted">{it.sub}</div>}
              </div>
            </div>
          )}

          {view.phase === "tier_item" && t.style === "vote" && !me?.spectator && (
            <div className="space-y-2">
              <TierButtons value={t.myVote} onPick={(tier) => act({ type: "tier_vote", tier })} />
              <p className="num text-center text-xs text-muted">
                صوّت {t.votes ?? 0} من {active.length}
                {t.myVote ? ` · صوتك ${t.myVote}، تقدر تغيّره` : ""}
              </p>
            </div>
          )}

          {view.phase === "tier_item" && t.style === "discuss" && (
            <div className="space-y-3">
              {!me?.spectator && <TierButtons value={t.placement?.tier} onPick={(tier) => act({ type: "tier_move", tier })} />}
              <AnimatePresence mode="popLayout">
                {t.placement ? (
                  <motion.div key={`${t.placement.by}-${t.placement.at}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-wrap items-center justify-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: color(t.placement.by) }} />
                    <span>
                      {name(t.placement.by)} حطّها في <span className="font-display text-lg" style={{ color: TIER_COLOR[t.placement.tier] }}>{t.placement.tier}</span>
                    </span>
                    <span className="num text-muted">
                      · موافقين {t.agrees.length} من {active.length}
                    </span>
                  </motion.div>
                ) : (
                  <p className="text-center text-sm text-muted">تناقشوا في المكالمة، وأي واحد يحطها في تير</p>
                )}
              </AnimatePresence>
              <div className="flex justify-center gap-2">
                {t.placement && !t.agrees.includes(view.me) && !me?.spectator && (
                  <button className="btn-primary" onClick={() => act({ type: "tier_agree" })}>
                    <Icon name="ThumbsUp" size={16} /> موافق
                  </button>
                )}
                {isHost && t.placement && (
                  <button className="btn-ghost" onClick={() => act({ type: "tier_pin" })}>
                    <Icon name="Pin" size={16} /> ثبّت
                  </button>
                )}
              </div>
            </div>
          )}

          {view.phase === "tier_tiebreak" && (
            <div className="space-y-2 text-center">
              <p className="text-sm text-muted">تعادل بالضبط بين تيرين. {isHost ? "احسمها:" : "المضيف يحسم."}</p>
              {isHost && <TierButtons onPick={(tier) => act({ type: "tier_pin", tier })} />}
            </div>
          )}

          {view.phase === "tier_result" && t.result && (
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={spring} className="space-y-3 text-center">
              {t.result.tier ? (
                <>
                  <div className="mx-auto grid h-20 w-20 place-items-center rounded-sm font-display text-5xl text-bg" style={{ background: TIER_COLOR[t.result.tier] }}>
                    {t.result.tier}
                  </div>
                  <p className="text-sm text-muted">{t.result.disagree ? `${t.result.disagree} ما وافقوا` : "كلكم متفقين"}</p>
                </>
              ) : (
                <p className="text-muted">ما انحطت في أي تير</p>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                {Object.entries(t.result.opinions).map(([u, o]) => (
                  <span key={u} className="flex items-center gap-1.5 rounded-sm border border-line px-2 py-1 text-xs">
                    {name(u)} <span className="font-display" style={{ color: TIER_COLOR[o] }}>{o}</span>
                  </span>
                ))}
              </div>
            </motion.div>
          )}

          {locked.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="label">اللوحة</div>
              <Board items={locked} board={t.board} />
            </div>
          )}
        </LayoutGroup>
      </div>
    );
  }

  // ---------------------------------------------------------------- individual boards
  if (view.phase === "tier_board") return <MyBoard view={view} t={t} act={act} name={name} />;

  // ---------------------------------------------------------------- reveal / end
  if (view.phase === "tier_reveal" || view.phase === "ending" || view.phase === "finished") return <Reveal view={view} t={t} act={act} name={name} isHost={isHost} />;
  return null;
}

function MyBoard({ view, t, act, name }: { view: View; t: TV; act: Act; name: (id?: string) => string }) {
  const [sel, setSel] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, Placement>>(t.myBoard);
  const items = t.items.slice(t.from);
  const done = t.submitted.includes(view.me);
  const me = view.players.find((p) => p.id === view.me);
  const board = useMemo(() => ({ ...t.myBoard, ...local }), [t.myBoard, local]);
  const tray = items.filter((it) => !board[it.id]);
  const place = (id: string, p: Placement | null) => {
    setLocal((x) => {
      const n = { ...x };
      if (p) n[id] = p;
      else delete n[id];
      return n;
    });
    void act({ type: "tier_place", itemId: id, place: p });
  };
  // desktop drag and drop
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail as { id: string; tier: Placement };
      place(d.id, d.tier);
    };
    window.addEventListener("tier-drop", h);
    return () => window.removeEventListener("tier-drop", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const guess = t.style === "guess_friend";
  const mine = guess && t.target === view.me;
  if (me?.spectator) return <p className="py-10 text-center text-muted">اللاعبين يرتّبون لوحاتهم</p>;
  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="font-display text-2xl">{guess ? (mine ? "رتّب لوحتك، والباقين يحاولون يخمنونها" : `كيف رتّبها ${name(t.target)}؟`) : "رتّب لوحتك"}</h2>
        <p className="text-sm text-muted">اضغط على عنصر وبعدين على التير. أو اسحبه في الكمبيوتر. واللي ما شفته حطه في «ما شفته».</p>
      </div>
      {tray.length > 0 && !done && (
        <LayoutGroup>
          <div className="flex flex-wrap justify-center gap-1.5 rounded-sm border border-dashed border-lineStrong p-2">
            {tray.map((it) => (
              <Tile key={it.id} it={it} selected={sel === it.id} onClick={() => setSel(sel === it.id ? null : it.id)} />
            ))}
          </div>
        </LayoutGroup>
      )}
      {sel && <p className="text-center text-sm text-accent">{label(items.find((x) => x.id === sel) ?? { title: "" })}: اختر التير</p>}
      <Board
        items={items}
        board={board}
        onRow={
          done
            ? undefined
            : (r) => {
                if (sel) {
                  place(sel, r);
                  setSel(null);
                }
              }
        }
      />
      {!done && Object.keys(board).length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn-quiet border border-line text-sm" onClick={() => items.forEach((it) => board[it.id] && place(it.id, null))}>
            <Icon name="RotateCcw" size={14} /> رجّع الكل
          </button>
        </div>
      )}
      <div className="flex items-center justify-center gap-3">
        {done ? (
          <p className="flex items-center gap-2 text-ok">
            <Icon name="Check" /> وصلت لوحتك. ننتظر الباقين <span className="num">({t.submitted.length}/{view.players.filter((p) => !p.spectator).length})</span>
          </p>
        ) : (
          <button className="btn-primary h-12 px-8" onClick={() => act({ type: "tier_submit" })}>
            <Icon name="Check" size={18} /> خلصت {tray.length ? <span className="num text-xs">({tray.length} باقي)</span> : null}
          </button>
        )}
      </div>
    </div>
  );
}

function Reveal({ view, t, act, name, isHost }: { view: View; t: TV; act: Act; name: (id?: string) => string; isHost: boolean }) {
  const [png, setPng] = useState<string | null>(null);
  const col = t.style === "vote" || t.style === "discuss";
  const items = t.items.filter((it) => t.board[it.id] || t.results?.[it.id]);
  const players = view.players.filter((p) => !p.spectator);
  const title = t.style === "guess_friend" ? `لوحة ${name(t.target)}` : col ? "لوحتنا" : "لوحة المتوسط";
  const diffRing = (uid: string) => {
    const b = t.boards?.[uid] ?? {};
    const r: Record<string, string> = {};
    for (const it of items) {
      const mine = b[it.id];
      const g = t.board[it.id];
      if (mine && mine !== "unseen" && g && Math.abs("SABCDF".indexOf(mine) - "SABCDF".indexOf(g)) >= 2) r[it.id] = "rgb(217 80 63)";
    }
    return r;
  };
  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-3xl">{title}</h2>
          <button
            className="btn-quiet border border-line"
            onClick={async () => {
              const url = await exportBoard(title, items, t.board);
              setPng(url);
              const a = document.createElement("a");
              a.href = url;
              a.download = "tier-list.png";
              a.click();
            }}
          >
            <Icon name="Download" size={16} /> صورة
          </button>
        </div>
        <Board items={items} board={t.board} />
        {png && <img src={png} alt="" className="hidden" />}
      </motion.div>

      {t.stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            t.stats.aligned && ["الأقرب للقروب", name(t.stats.aligned.id), `فرق ${t.stats.aligned.diff} تير`],
            t.stats.outlier && ["الشاذ", name(t.stats.outlier.id), `فرق ${t.stats.outlier.diff} تير`],
            t.stats.disputed && ["أكثر عنصر عليه خلاف", label(t.items.find((x) => x.id === t.stats!.disputed!.id) ?? { title: "؟" }), ""],
            t.stats.agreed && ["أكثر عنصر متفقين عليه", label(t.items.find((x) => x.id === t.stats!.agreed!.id) ?? { title: "؟" }), ""],
          ]
            .filter((x): x is string[] => !!x)
            .map(([k, v, sub], i) => (
              <motion.div key={k} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 * i }} className="panel p-3">
                <div className="label">{k}</div>
                <div className="mt-1 truncate font-display text-lg">{v}</div>
                {sub && <div className="num text-xs text-muted">{sub}</div>}
              </motion.div>
            ))}
        </div>
      )}

      {t.boards && (
        <div className="space-y-2">
          <div className="label">كل اللوحات (الأحمر = فرق تيرين أو أكثر)</div>
          <div className="grid gap-4 sm:grid-cols-2">
            {players.map((p, i) => (
              <motion.div key={p.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.2 }} className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <Avatar name={p.name} color={p.color} icon={p.avatar} size={22} />
                  {p.name}
                  {t.target === p.id && <span className="text-xs text-accent">صاحب اللوحة</span>}
                  <span className="num ms-auto text-xs text-muted">+{t.points[p.id] ?? 0}</span>
                </div>
                <Board items={items} board={t.boards?.[p.id] ?? {}} rings={diffRing(p.id)} compact />
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {view.phase === "tier_reveal" && isHost && (
        <div className="flex justify-center">
          <button className="btn-primary" onClick={() => act({ type: "tier_continue" })}>
            <Icon name="SkipForward" size={16} className="rtl:-scale-x-100" /> التالي
          </button>
        </div>
      )}
      {view.phase === "finished" && (
        <div className="flex justify-center">
          <Link href="/tierlists" className="btn-ghost">
            <Icon name="Rows3" size={16} /> تير ليستاتنا
          </Link>
        </div>
      )}
    </div>
  );
}
