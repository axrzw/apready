"use client";
import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, type RoomSettings } from "@gtw/core/room";
import { MODES } from "@gtw/core/questions";
import { EFFECTS, POSTER_EFFECTS } from "@gtw/core/effects";
import { CATEGORIES, TIERS, type Category, type ModeId } from "@gtw/core/types";
import { CATEGORY_AR, CATEGORY_EN, TIER_AR } from "@gtw/core/i18n";
import type { Lang } from "@/lib/i18n";
import { Icon } from "@/lib/icons";
import { Segmented, Skeleton } from "./ui";

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-3">
        <span className="num text-xs text-faint">{String(n).padStart(2, "0")}</span>
        <h3 className="font-display text-lg">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className="block space-y-1.5">
      <span className="label">{label}</span>
      <div className="flex h-11 items-center rounded border border-line bg-surface2">
        <button type="button" className="h-full px-3 text-muted hover:text-text" onClick={() => onChange(Math.max(min, value - 1))} aria-label="-">
          <Icon name="ChevronDown" size={16} />
        </button>
        <input type="number" className="num h-full w-full bg-transparent text-center outline-none" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))} />
        <button type="button" className="h-full px-3 text-muted hover:text-text" onClick={() => onChange(Math.min(max, value + 1))} aria-label="+">
          <Icon name="ChevronUp" size={16} />
        </button>
      </div>
    </label>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (b: boolean) => void; children: React.ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex items-center gap-3 text-start text-sm">
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-accent" : "bg-surface2 ring-1 ring-lineStrong"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-text transition-all ${checked ? "start-[18px] bg-accentInk" : "start-0.5"}`} />
      </span>
      {children}
    </button>
  );
}

export default function SettingsForm({ initial, onSubmit, submitLabel, lang, allowParty = true }: { initial?: Partial<RoomSettings>; onSubmit: (s: RoomSettings) => void | Promise<void>; submitLabel: string; lang: Lang; allowParty?: boolean }) {
  const [s, setS] = useState<RoomSettings>({ ...DEFAULT_SETTINGS, ...initial });
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/modes")
      .then((r) => r.json())
      .then((j) => {
        setCounts(j.counts ?? {});
        if (j.defaultMix && !initial?.mix) setS((x) => ({ ...x, mix: j.defaultMix }));
      });
  }, [initial?.mix]);
  const set = <K extends keyof RoomSettings>(k: K, v: RoomSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const toggleMode = (m: ModeId) => set("modes", s.modes.includes(m) ? s.modes.filter((x) => x !== m) : [...s.modes, m]);
  const toggleCat = (c: Category) => set("categories", s.categories.includes(c) ? s.categories.filter((x) => x !== c) : [...s.categories, c]);
  const mixTotal = TIERS.reduce((a, t) => a + s.mix[t], 0) || 1;
  let n = 0;

  return (
    <form
      className="panel space-y-5 p-4 sm:p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit(s);
        } finally {
          setBusy(false);
        }
      }}
    >
      {allowParty && (
        <Section n={++n} title="نوع اللعب">
          <Segmented
            value={s.kind}
            onChange={(k) => set("kind", k)}
            options={[
              { value: "guess", label: "أطوار التخمين", icon: "LayoutGrid" },
              { value: "describer", label: "الواصف", icon: "Mic" },
              { value: "drawer", label: "الرسّام", icon: "Pen" },
            ]}
          />
        </Section>
      )}

      {s.kind === "guess" && (
        <Section n={++n} title={s.modes.length > 1 ? `Mix · ${s.modes.length} أطوار` : "الطور"}>
          {!counts ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Array.from({ length: 9 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {MODES.map((m) => {
                const c = counts[m.id] ?? 0;
                const on = s.modes.includes(m.id);
                return (
                  <button
                    type="button"
                    key={m.id}
                    disabled={!c}
                    onClick={() => toggleMode(m.id)}
                    className={`flex items-center gap-3 rounded border px-3 py-2.5 text-start transition-colors disabled:opacity-30 ${on ? "border-accent/70 bg-accent/10" : "border-line hover:border-lineStrong"}`}
                  >
                    <Icon name={m.icon} size={18} className={on ? "text-accent" : "text-muted"} />
                    <span className="flex-1 text-sm">{m[lang]}</span>
                    <span className="num text-[11px] text-faint">{c ? c.toLocaleString("en-US") : "—"}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex gap-3 text-xs">
            <button type="button" className="text-muted underline-offset-4 hover:text-text hover:underline" onClick={() => set("modes", MODES.map((m) => m.id).filter((m) => (counts?.[m] ?? 0) > 0))}>
              كل الأطوار (Mix)
            </button>
            <button type="button" className="text-muted underline-offset-4 hover:text-text hover:underline" onClick={() => set("modes", [])}>
              مسح
            </button>
          </div>
        </Section>
      )}

      <Section n={++n} title="الأقسام">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button type="button" key={c} className={`toggle ${s.categories.includes(c) ? "toggle-on" : ""}`} onClick={() => toggleCat(c)}>
              {lang === "ar" ? CATEGORY_AR[c] : CATEGORY_EN[c]}
            </button>
          ))}
          {!s.categories.length && <span className="self-center text-xs text-faint">بدون اختيار = الكل</span>}
        </div>
      </Section>

      <Section n={++n} title="الإيقاع">
        <div className="grid gap-3 sm:grid-cols-3">
          <Num label={s.kind === "guess" ? "عدد الأسئلة" : "الجولات (كل لاعب بدوره)"} value={s.count} min={1} max={50} onChange={(v) => set("count", v)} />
          {s.kind === "guess" && <Num label="ثواني لكل سؤال" value={s.timeLimitSec} min={5} max={180} onChange={(v) => set("timeLimitSec", v)} />}
          {s.kind === "describer" && <Num label="ثواني الدور" value={s.describe.turnSec} min={20} max={240} onChange={(v) => set("describe", { ...s.describe, turnSec: v })} />}
          {s.kind === "drawer" && <Num label="ثواني الرسم" value={s.draw.drawSec} min={30} max={300} onChange={(v) => set("draw", { ...s.draw, drawSec: v })} />}
          {s.kind === "drawer" && <Num label="ثواني التخمين لكل رسمة" value={s.draw.guessSec} min={10} max={120} onChange={(v) => set("draw", { ...s.draw, guessSec: v })} />}
          {s.kind === "drawer" && <Num label="ثواني التصويت" value={s.draw.voteSec} min={10} max={120} onChange={(v) => set("draw", { ...s.draw, voteSec: v })} />}
        </div>
        {s.kind === "guess" && (
          <div className="space-y-1.5">
            <span className="label">طريقة الإجابة</span>
            <Segmented
              value={s.method}
              onChange={(v) => set("method", v)}
              options={[
                { value: "both", label: "كتابة، ومعها اختيار من ٤" },
                { value: "text", label: "كتابة فقط" },
                { value: "choice", label: "اختيار من ٤ فقط" },
              ]}
            />
          </div>
        )}
        {s.kind === "describer" && (
          <div className="flex flex-wrap gap-4">
            <Segmented
              value={s.describe.via}
              onChange={(v) => set("describe", { ...s.describe, via: v })}
              options={[
                { value: "voice", label: "شرح صوتي في الديسكورد", icon: "Mic" },
                { value: "chat", label: "كتابة في شات الغرفة", icon: "MessageSquare" },
              ]}
            />
            <Check checked={s.describe.choose} onChange={(b) => set("describe", { ...s.describe, choose: b })}>
              يختار من عنصرين
            </Check>
          </div>
        )}
        {s.kind === "drawer" && (
          <Check checked={s.draw.choose} onChange={(b) => set("draw", { ...s.draw, choose: b })}>
            كل رسام يختار من عنصرين
          </Check>
        )}
      </Section>

      <Section n={++n} title="طبقات الشهرة">
        <div className="space-y-3">
          {TIERS.map((t) => (
            <label key={t} className="grid grid-cols-[72px_1fr_44px] items-center gap-3 text-sm">
              <span>{TIER_AR[t]}</span>
              <input type="range" min={0} max={100} value={s.mix[t]} onChange={(e) => set("mix", { ...s.mix, [t]: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
              <span className="num text-end text-muted">{Math.round((s.mix[t] / mixTotal) * 100)}%</span>
            </label>
          ))}
        </div>
        <Check checked={s.adaptive} onChange={(b) => set("adaptive", b)}>
          الصعوبة تتعدّل حسب نسبة إجاباتنا الصحيحة
        </Check>
      </Section>

      {s.kind === "guess" && (
        <Section n={++n} title="التلميحات">
          <div className="flex flex-wrap items-end gap-4">
            <Check checked={s.hints.enabled} onChange={(b) => set("hints", { ...s.hints, enabled: b })}>
              مفعّلة
            </Check>
            {s.hints.enabled && (
              <>
                <div className="w-36">
                  <Num label="الحد الأقصى" value={s.hints.max} min={1} max={8} onChange={(v) => set("hints", { ...s.hints, max: v })} />
                </div>
                <Segmented
                  value={s.hints.reveal}
                  onChange={(v) => set("hints", { ...s.hints, reveal: v })}
                  options={[
                    { value: "request", label: "كل واحد يطلب لنفسه" },
                    { value: "auto", label: "تنكشف للكل مع الوقت" },
                  ]}
                />
              </>
            )}
          </div>
        </Section>
      )}

      {s.kind === "guess" && (s.modes.includes("poster") || s.modes.includes("scene")) && (
        <Section n={++n} title="تأثيرات الصور">
          <div className="flex flex-wrap gap-2">
            {POSTER_EFFECTS.map((e) => (
              <button type="button" key={e} className={`toggle ${s.effects.includes(e) ? "toggle-on" : ""}`} onClick={() => set("effects", s.effects.includes(e) ? s.effects.filter((x) => x !== e) : [...s.effects, e])}>
                {EFFECTS[e][lang === "ar" ? "ar" : "en"]}
                <span className="flex gap-0.5" aria-label={`difficulty ${EFFECTS[e].difficulty}`}>
                  {[1, 2, 3].map((d) => (
                    <span key={d} className={`h-1.5 w-1.5 rounded-full ${d <= EFFECTS[e].difficulty ? "bg-accent" : "bg-faint/40"}`} />
                  ))}
                </span>
              </button>
            ))}
          </div>
          {s.modes.includes("scene") && (
            <div className="space-y-1.5">
              <span className="label">صعوبة المشهد</span>
              <Segmented
                value={s.sceneLevel}
                onChange={(v) => set("sceneLevel", v)}
                options={[
                  { value: 1, label: "لقطة تنكشف" },
                  { value: 2, label: "مقطع صامت" },
                  { value: 3, label: "مقطع بالصوت" },
                ]}
              />
            </div>
          )}
        </Section>
      )}

      <button className="btn-primary h-12 w-full text-base" disabled={busy || (s.kind === "guess" && !s.modes.length)}>
        {busy ? "لحظة" : submitLabel}
      </button>
    </form>
  );
}
