"use client";
import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, mergeSettings, type RoomSettings } from "@gtw/core/room";
import { applyPreset, detectPreset } from "@gtw/core/pacing";
import { MODES } from "@gtw/core/questions";
import { EFFECTS, POSTER_EFFECTS } from "@gtw/core/effects";
import { SECTIONS, TIERS, type ModeId } from "@gtw/core/types";
import { SECTION_AR, SECTION_EN, TIER_AR } from "@gtw/core/i18n";
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
  const toggleCat = (c: string) => set("categories", s.categories.includes(c) ? s.categories.filter((x) => x !== c) : [...s.categories, c]);
  const mixTotal = TIERS.reduce((a, t) => a + s.mix[t], 0) || 1;
  const [advanced, setAdvanced] = useState(false);
  const [custom, setCustom] = useState(false);
  const preset = custom ? "custom" : detectPreset(s);
  // the host's last length / time choice for this mode, else the «عادية» preset
  const remembered = async (kind: RoomSettings["kind"], base: RoomSettings) => {
    try {
      const r = await fetch(`/api/pace?kind=${kind}`, { cache: "no-store" });
      const saved = (await r.json()) as Partial<RoomSettings> | null;
      if (saved) return mergeSettings(base, saved);
    } catch {}
    return applyPreset(base, "normal");
  };
  const switchKind = (k: RoomSettings["kind"]) => {
    setCustom(false);
    setS((x) => ({ ...x, kind: k }));
    void remembered(k, { ...s, kind: k }).then((next) => setS((x) => (x.kind === k ? { ...x, ...pick(next) } : x)));
  };
  useEffect(() => {
    if (initial?.count !== undefined && initial.count !== DEFAULT_SETTINGS.count) return; // a template or a running room's choice
    const k = s.kind;
    void remembered(k, s).then((next) => setS((x) => (x.kind === k ? { ...x, ...pick(next) } : x)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const summary = paceSummary(s);
  let n = 0;

  return (
    <>
    <Templates current={s} onLoad={(t) => setS({ ...DEFAULT_SETTINGS, ...t })} />
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
            onChange={(k) => switchKind(k)}
            options={[
              { value: "guess", label: "أطوار التخمين", icon: "LayoutGrid" },
              { value: "describer", label: "الواصف", icon: "Mic" },
              { value: "camera", label: "اشرح بالكاميرا", icon: "Video" },
              { value: "social", label: "اجتماعي", icon: "Users" },
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

      <Section n={++n} title="الطول والوقت">
        <Segmented
          value={preset}
          onChange={(v) => (v === "custom" ? setCustom(true) : (setCustom(false), setS((x) => applyPreset(x, v))))}
          options={[
            { value: "quick", label: "سريعة", icon: "Zap" },
            { value: "normal", label: "عادية", icon: "Timer" },
            { value: "long", label: "طويلة", icon: "Moon" },
            { value: "custom", label: "مخصص", icon: "SlidersHorizontal" },
          ]}
        />
        <p className="num text-sm text-muted">{summary}</p>
        {(preset === "custom" || custom) && (
        <div className="grid gap-3 sm:grid-cols-3">
            {s.kind !== "pack" && !s.pace.open && <Num label={s.kind === "guess" || s.kind === "social" ? "عدد الأسئلة" : s.kind === "drawer" ? "الجولات" : "الجولات (كل لاعب بدوره)"} value={s.count} min={1} max={50} onChange={(v) => set("count", v)} />}
            {(s.kind === "guess" || s.kind === "social" || s.kind === "pack") && <Num label="ثواني لكل سؤال" value={s.timeLimitSec} min={5} max={180} onChange={(v) => set("timeLimitSec", v)} />}
            {(s.kind === "describer" || s.kind === "camera") && <Num label="ثواني الدور" value={s.describe.turnSec} min={20} max={240} onChange={(v) => set("describe", { ...s.describe, turnSec: v })} />}
            {s.kind === "camera" && <Num label="ثواني تجهيز الكاميرا" value={s.camera.setupSec} min={10} max={120} onChange={(v) => set("camera", { ...s.camera, setupSec: v })} />}
            {s.kind === "drawer" && <Num label="ثواني الرسم" value={s.draw.drawSec} min={30} max={300} onChange={(v) => set("draw", { ...s.draw, drawSec: v })} />}
            {s.kind === "drawer" && <Num label="ثواني التخمين لكل رسمة" value={s.draw.guessSec} min={10} max={120} onChange={(v) => set("draw", { ...s.draw, guessSec: v })} />}
            {s.kind === "drawer" && <Num label="ثواني التصويت" value={s.draw.voteSec} min={10} max={120} onChange={(v) => set("draw", { ...s.draw, voteSec: v })} />}
          </div>
        )}
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {s.kind !== "pack" && (
            <Check checked={s.pace.open} onChange={(b) => set("pace", { ...s.pace, open: b })}>
              مفتوح (يستمر لين أقول خلاص)
            </Check>
          )}
          <Check checked={s.pace.extendVote} onChange={(b) => set("pace", { ...s.pace, extendVote: b })}>
            تصويت على التمديد في النهاية
          </Check>
        </div>
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
        {s.kind === "social" && (
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["who_watched", "مين شافه؟"],
                ["guess_rating", "خمّن تقييمه"],
              ] as const
            ).map(([k, label]) => (
              <button type="button" key={k} className={`toggle ${s.socialModes.includes(k) ? "toggle-on" : ""}`} onClick={() => set("socialModes", s.socialModes.includes(k) ? s.socialModes.filter((x) => x !== k) : [...s.socialModes, k])}>
                {label}
              </button>
            ))}
          </div>
        )}
        {s.kind === "camera" && (
          <Segmented
            value={s.camera.style}
            onChange={(v) => set("camera", { ...s.camera, style: v })}
            options={[
              { value: "talk", label: "مسموح الكلام بدون الكلمات الممنوعة", icon: "Mic" },
              { value: "mime", label: "تمثيل صامت (المايك مقفل)", icon: "Hand" },
            ]}
          />
        )}
        {s.kind === "drawer" && (
          <Check checked={s.draw.choose} onChange={(b) => set("draw", { ...s.draw, choose: b })}>
            كل رسام يختار من عنصرين
          </Check>
        )}
      </Section>

      <button type="button" className="flex w-full items-center justify-between border-t border-line pt-5 text-start" onClick={() => setAdvanced((x) => !x)} aria-expanded={advanced}>
        <span className="flex items-center gap-2 font-display text-lg">
          <Icon name="Settings2" size={18} className="text-accent" /> إعدادات متقدمة
        </span>
        <Icon name={advanced ? "ChevronUp" : "ChevronDown"} size={18} className="text-muted" />
      </button>
      {advanced && (
        <>
      <Section n={++n} title="الأقسام">
        <div className="flex flex-wrap gap-2">
          {SECTIONS.map((c) => (
            <button type="button" key={c} className={`toggle ${s.categories.includes(c) ? "toggle-on" : ""}`} onClick={() => toggleCat(c)}>
              {lang === "ar" ? SECTION_AR[c] : SECTION_EN[c]}
            </button>
          ))}
          {!s.categories.length && <span className="self-center text-xs text-faint">بدون اختيار = الكل</span>}
        </div>
      </Section>

      <Section n={++n} title="مصدر الأسئلة">
        <Segmented
          value={s.source}
          onChange={(v) => set("source", v)}
          options={[
            { value: "any", label: "أي شي من المكتبة" },
            { value: "someone", label: "اللي شافه واحد منا" },
            { value: "everyone", label: "اللي شافه كل اللي بالغرفة" },
          ]}
        />
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <Check checked={s.excludeOwnOnly} onChange={(b) => set("excludeOwnOnly", b)}>
            استثنِ اللي شافه السائل
          </Check>
          <Check checked={s.noSpoilers} onChange={(b) => set("noSpoilers", b)}>
            بدون حرق
          </Check>
        </div>
        <div className="grid max-w-sm grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="label">من سنة</span>
            <input type="number" className="field num" placeholder="1960" value={s.years?.[0] ?? ""} onChange={(e) => set("years", [e.target.value ? Number(e.target.value) : null, s.years?.[1] ?? null])} />
          </label>
          <label className="block space-y-1.5">
            <span className="label">إلى سنة</span>
            <input type="number" className="field num" placeholder="2026" value={s.years?.[1] ?? ""} onChange={(e) => set("years", [s.years?.[0] ?? null, e.target.value ? Number(e.target.value) : null])} />
          </label>
        </div>
      </Section>

      {s.kind === "guess" && (
        <Section n={++n} title="الإجابة">
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
        {s.kind === "guess" && (
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <span className="label">الإكمال التلقائي</span>
              <Segmented
                value={s.autocomplete}
                onChange={(v) => set("autocomplete", v)}
                options={[
                  { value: "on", label: "مفعّل" },
                  { value: "reduced", label: "مفعّل بنقاط أقل" },
                  { value: "off", label: "مطفأ (تحدي)" },
                ]}
              />
            </div>
            <Check checked={s.firstOnly} onChange={(b) => set("firstOnly", b)}>
              الأول فقط ياخذ النقاط
            </Check>
          </div>
        )}
        </Section>
      )}
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
        <div className="space-y-3 border-t border-line pt-4">
          <div className="label">طبقات القروب (من سجلات المشاهدة)</div>
          {(
            [
              ["group_common", "أغلبنا شافه"],
              ["group_niche", "واحد أو اثنين"],
              ["group_unknown", "محد شافه"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="grid grid-cols-[96px_1fr_44px] items-center gap-3 text-sm">
              <span>{label}</span>
              <input type="range" min={0} max={100} value={s.groupMix[k]} onChange={(e) => set("groupMix", { ...s.groupMix, [k]: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
              <span className="num text-end text-muted">{s.groupMix[k]}</span>
            </label>
          ))}
          <label className="grid grid-cols-[96px_1fr_44px] items-center gap-3 text-sm">
            <span>وزن القروب</span>
            <input type="range" min={0} max={100} value={s.groupWeight} onChange={(e) => set("groupWeight", Number(e.target.value))} className="w-full accent-[var(--accent)]" />
            <span className="num text-end text-muted">{s.groupWeight}%</span>
          </label>
          <p className="text-xs text-faint">٠٪ = الطبقات العالمية بس، ١٠٠٪ = طبقات القروب بس.</p>
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

        </>
      )}

      <button className="btn-primary h-12 w-full text-base" disabled={busy || (s.kind === "guess" && !s.modes.length)}>
        {busy ? "لحظة" : submitLabel}
      </button>
    </form>
    </>
  );
}

/** Only the length / time / pace fields (so a late answer never overwrites other choices). */
function pick(x: RoomSettings) {
  return { count: x.count, timeLimitSec: x.timeLimitSec, describe: x.describe, draw: x.draw, camera: x.camera, pace: x.pace };
}

/** «10 أسئلة · 30 ثانية لكل سؤال» */
function paceSummary(s: RoomSettings): string {
  const len = s.pace.open
    ? "مفتوح"
    : s.kind === "pack"
      ? "أسئلة الباقة"
      : s.kind === "guess" || s.kind === "social"
        ? `${s.count} ${s.count <= 10 && s.count > 2 ? "أسئلة" : "سؤال"}`
        : `${s.count} ${s.count === 1 ? "جولة" : s.count <= 10 ? "جولات" : "جولة"}`;
  const time =
    s.kind === "drawer"
      ? `${s.draw.drawSec} ثانية رسم، ${s.draw.guessSec} تخمين، ${s.draw.voteSec} تصويت`
      : s.kind === "describer" || s.kind === "camera"
        ? `${s.describe.turnSec} ثانية للدور${s.kind === "camera" ? `، ${s.camera.setupSec} للتجهيز` : ""}`
        : `${s.timeLimitSec} ثانية لكل سؤال`;
  return `${len} · ${time}`;
}

/** Saved settings with a name («سهرة خفيفة», «تحدي المغمور»), shared by the group. */
function Templates({ current, onLoad }: { current: RoomSettings; onLoad: (s: RoomSettings) => void }) {
  const [list, setList] = useState<{ id: string; name: string; settings: RoomSettings }[]>([]);
  const load = () => fetch("/api/templates").then((r) => r.json()).then(setList, () => {});
  useEffect(() => void load(), []);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="label">القوالب</span>
      {list.map((t) => (
        <button type="button" key={t.id} className="toggle h-8" onClick={() => onLoad(t.settings)}>
          {t.name}
        </button>
      ))}
      <button
        type="button"
        className="btn-quiet h-8 border border-line"
        onClick={async () => {
          const name = prompt("اسم القالب؟ (مثلاً: سهرة خفيفة)");
          if (!name) return;
          await fetch("/api/templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, settings: current }) });
          void load();
        }}
      >
        <Icon name="Plus" size={14} /> احفظ الإعدادات كقالب
      </button>
    </div>
  );
}
