"use client";
import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, type RoomSettings } from "@gtw/core/room";
import { MODES } from "@gtw/core/questions";
import { EFFECTS, POSTER_EFFECTS } from "@gtw/core/effects";
import { CATEGORIES, TIERS, type Category, type ModeId } from "@gtw/core/types";
import { CATEGORY_AR, CATEGORY_EN, TIER_AR } from "@gtw/core/i18n";
import type { Lang } from "@/lib/i18n";

export default function SettingsForm({
  initial,
  onSubmit,
  submitLabel,
  lang,
  allowParty = true,
}: {
  initial?: Partial<RoomSettings>;
  onSubmit: (s: RoomSettings) => void | Promise<void>;
  submitLabel: string;
  lang: Lang;
  allowParty?: boolean;
}) {
  const [s, setS] = useState<RoomSettings>({ ...DEFAULT_SETTINGS, ...initial });
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/modes")
      .then((r) => r.json())
      .then((j) => setCounts(j.counts ?? {}));
  }, []);
  const set = <K extends keyof RoomSettings>(k: K, v: RoomSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const toggleMode = (m: ModeId) => set("modes", s.modes.includes(m) ? s.modes.filter((x) => x !== m) : [...s.modes, m]);
  const toggleCat = (c: Category) => set("categories", s.categories.includes(c) ? s.categories.filter((x) => x !== c) : [...s.categories, c]);
  const mixTotal = TIERS.reduce((a, t) => a + s.mix[t], 0) || 1;

  return (
    <form
      className="card space-y-5"
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
        <div>
          <span className="label">نوع اللعب</span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["guess", "🎯 أطوار التخمين / Mix"],
                ["describer", "🎙️ الواصف"],
                ["drawer", "🎨 الرسّام"],
              ] as const
            ).map(([k, label]) => (
              <button type="button" key={k} className={`chip ${s.kind === k ? "chip-on" : ""}`} onClick={() => set("kind", k)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {s.kind === "guess" && (
        <div>
          <span className="label">الأطوار (اختر أكثر من واحد = Mix)</span>
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => {
              const n = counts[m.id];
              const empty = n === 0;
              return (
                <button type="button" key={m.id} disabled={empty} title={empty ? "ما فيه مادة لهذا الطور بالمكتبة الحين" : `${n ?? "…"} سؤال`} className={`chip ${s.modes.includes(m.id) ? "chip-on" : ""} ${empty ? "opacity-40" : ""}`} onClick={() => toggleMode(m.id)}>
                  {m.icon} {m[lang]}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2 text-xs">
            <button type="button" className="underline" onClick={() => set("modes", MODES.map((m) => m.id).filter((m) => counts[m] !== 0))}>
              اختر الكل (Mix)
            </button>
            <button type="button" className="underline" onClick={() => set("modes", [])}>
              امسح
            </button>
          </div>
        </div>
      )}

      <div>
        <span className="label">الأقسام (فاضي = الكل)</span>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button type="button" key={c} className={`chip ${s.categories.includes(c) ? "chip-on" : ""}`} onClick={() => toggleCat(c)}>
              {lang === "ar" ? CATEGORY_AR[c] : CATEGORY_EN[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label>
          <span className="label">{s.kind === "guess" ? "عدد الأسئلة" : "عدد الجولات (كل لاعب بدوره)"}</span>
          <input type="number" className="input" min={1} max={50} value={s.count} onChange={(e) => set("count", Number(e.target.value))} />
        </label>
        {s.kind === "guess" && (
          <label>
            <span className="label">المدة لكل سؤال (ثانية)</span>
            <input type="number" className="input" min={5} max={180} value={s.timeLimitSec} onChange={(e) => set("timeLimitSec", Number(e.target.value))} />
          </label>
        )}
        {s.kind === "guess" && (
          <label>
            <span className="label">طريقة الإجابة</span>
            <select className="input" value={s.method} onChange={(e) => set("method", e.target.value as RoomSettings["method"])}>
              <option value="both">كتابة + خيار «اختيار من ٤»</option>
              <option value="text">كتابة فقط</option>
              <option value="choice">اختيار من ٤ فقط (نقاط أقل)</option>
            </select>
          </label>
        )}
      </div>

      <div>
        <span className="label">نسب الشهرة (المشهور / المتوسط / المظلوم / المغمور)</span>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TIERS.map((t) => (
            <label key={t} className="text-sm">
              <span className="flex justify-between">
                <span>{TIER_AR[t]}</span>
                <span className="text-zinc-400">{Math.round((s.mix[t] / mixTotal) * 100)}%</span>
              </span>
              <input type="range" min={0} max={100} value={s.mix[t]} onChange={(e) => set("mix", { ...s.mix, [t]: Number(e.target.value) })} className="w-full accent-amber-500" />
            </label>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={s.adaptive} onChange={(e) => set("adaptive", e.target.checked)} /> الصعوبة تتعدّل تلقائياً حسب نسبة إجاباتنا الصحيحة
        </label>
      </div>

      {s.kind === "guess" && (
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={s.hints.enabled} onChange={(e) => set("hints", { ...s.hints, enabled: e.target.checked })} /> التلميحات
          </label>
          <label>
            <span className="label">أقصى عدد تلميحات</span>
            <input type="number" className="input" min={0} max={8} value={s.hints.max} onChange={(e) => set("hints", { ...s.hints, max: Number(e.target.value) })} />
          </label>
          <label>
            <span className="label">كشف التلميحات</span>
            <select className="input" value={s.hints.reveal} onChange={(e) => set("hints", { ...s.hints, reveal: e.target.value as "request" | "auto" })}>
              <option value="request">كل لاعب يطلب لنفسه</option>
              <option value="auto">تنكشف للكل مع الوقت</option>
            </select>
          </label>
        </div>
      )}

      {s.kind === "guess" && (s.modes.includes("poster") || s.modes.includes("scene")) && (
        <div>
          <span className="label">تأثيرات البوستر</span>
          <div className="flex flex-wrap gap-2">
            {POSTER_EFFECTS.map((e) => (
              <button type="button" key={e} className={`chip ${s.effects.includes(e) ? "chip-on" : ""}`} onClick={() => set("effects", s.effects.includes(e) ? s.effects.filter((x) => x !== e) : [...s.effects, e])}>
                {EFFECTS[e][lang === "ar" ? "ar" : "en"]} {"★".repeat(EFFECTS[e].difficulty)}
              </button>
            ))}
          </div>
          {s.modes.includes("scene") && (
            <label className="mt-3 block">
              <span className="label">صعوبة المشهد</span>
              <select className="input" value={s.sceneLevel} onChange={(e) => set("sceneLevel", Number(e.target.value) as 1 | 2 | 3)}>
                <option value={1}>لقطة ثابتة تنكشف (الأصعب)</option>
                <option value={2}>مقطع صامت</option>
                <option value={3}>مقطع بالصوت (الأسهل)</option>
              </select>
            </label>
          )}
        </div>
      )}

      {s.kind === "describer" && (
        <div className="grid gap-4 sm:grid-cols-3">
          <label>
            <span className="label">الوصف</span>
            <select className="input" value={s.describe.via} onChange={(e) => set("describe", { ...s.describe, via: e.target.value as "voice" | "chat" })}>
              <option value="voice">صوتي في الديسكورد</option>
              <option value="chat">كتابة في شات الغرفة</option>
            </select>
          </label>
          <label>
            <span className="label">مدة الدور (ثانية)</span>
            <input type="number" className="input" min={20} max={240} value={s.describe.turnSec} onChange={(e) => set("describe", { ...s.describe, turnSec: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={s.describe.choose} onChange={(e) => set("describe", { ...s.describe, choose: e.target.checked })} /> الواصف يختار من عنصرين
          </label>
        </div>
      )}
      {s.kind === "drawer" && (
        <div className="grid gap-4 sm:grid-cols-4">
          <label>
            <span className="label">وقت الرسم</span>
            <input type="number" className="input" min={30} max={300} value={s.draw.drawSec} onChange={(e) => set("draw", { ...s.draw, drawSec: Number(e.target.value) })} />
          </label>
          <label>
            <span className="label">وقت التخمين لكل رسمة</span>
            <input type="number" className="input" min={10} max={120} value={s.draw.guessSec} onChange={(e) => set("draw", { ...s.draw, guessSec: Number(e.target.value) })} />
          </label>
          <label>
            <span className="label">وقت التصويت</span>
            <input type="number" className="input" min={10} max={120} value={s.draw.voteSec} onChange={(e) => set("draw", { ...s.draw, voteSec: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={s.draw.choose} onChange={(e) => set("draw", { ...s.draw, choose: e.target.checked })} /> اختيار من عنصرين
          </label>
        </div>
      )}

      <button className="btn-primary w-full py-3 text-lg" disabled={busy || (s.kind === "guess" && !s.modes.length)}>
        {busy ? "…" : submitLabel}
      </button>
    </form>
  );
}
