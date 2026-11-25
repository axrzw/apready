"use client";
import { useEffect, useState } from "react";
import type { RoomSettings } from "@gtw/core/room";
import type { TierSettings, TierTopicType } from "@gtw/core/tier-settings";
import { SECTIONS } from "@gtw/core/types";
import { SECTION_AR } from "@gtw/core/i18n";
import { loadIndex, suggest, type AcKind } from "@/lib/autocomplete-client";
import type { Suggestion } from "@gtw/core/autocomplete";
import { Icon } from "@/lib/icons";
import { Segmented } from "./ui";

const TOPICS: [TierTopicType, string][] = [
  ["anime", "أنمي"],
  ["series", "مسلسلات"],
  ["movie", "أفلام"],
  ["game", "ألعاب"],
  ["character", "شخصيات"],
  ["opening", "أوبننقات"],
  ["ending", "إندنقات"],
  ["ost", "أوستات"],
  ["custom", "فلاتر خاصة"],
];

/** «تير ليست» setup: how you decide, what you rank, where the items come from. */
export default function TierSetup({ s, set, players }: { s: RoomSettings; set: <K extends keyof RoomSettings>(k: K, v: RoomSettings[K]) => void; players?: { id: string; name: string }[] }) {
  const t = s.tier;
  const up = (patch: Partial<TierSettings>) => set("tier", { ...t, ...patch });
  const topic = (patch: Partial<TierSettings["topic"]>) => up({ topic: { ...t.topic, ...patch } });
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <span className="label">كيف نقرر</span>
        <Segmented
          value={t.style}
          onChange={(v) => up({ style: v })}
          options={[
            { value: "vote", label: "تصويت سري", icon: "Users" },
            { value: "discuss", label: "نقاش حر", icon: "MessageSquare" },
            { value: "solo", label: "كل واحد لوحته", icon: "Rows3" },
            { value: "guess_friend", label: "خمّن تير صاحبك", icon: "Eye" },
          ]}
        />
        <p className="text-xs text-faint">
          {t.style === "vote"
            ? "كل عنصر لحاله: الكل يصوّت بالسر، والأغلبية تقرر. وإذا ما فيه أغلبية ناخذ المتوسط، ولو تعادل بالضبط المضيف يحسم. والنقاط حسب قربك من قرار القروب."
            : t.style === "discuss"
              ? "لوحة وحدة للكل: أي واحد يحرّك العنصر، ويثبت بأغلبية «موافق» أو بـ«ثبّت» من المضيف."
              : t.style === "solo"
                ? "كل واحد يرتّب لوحته بالسر، وبعدها كشف كل اللوحات ولوحة المتوسط. والنقاط حسب قربك من المتوسط."
                : "صاحبك يرتّب لوحته، وأنتم تخمّنون وين حط كل عنصر."}
        </p>
      </div>
      {t.style === "discuss" && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={t.points} onChange={(e) => up({ points: e.target.checked })} className="accent-[var(--accent)]" /> نقاط حسب قرب رأيك من القرار
        </label>
      )}
      {t.style === "guess_friend" && players && players.length > 1 && (
        <div className="space-y-1.5">
          <span className="label">لوحة مين؟</span>
          <div className="flex flex-wrap gap-2">
            {players.map((p) => (
              <button type="button" key={p.id} className={`toggle ${(t.target ?? players[0].id) === p.id ? "toggle-on" : ""}`} onClick={() => up({ target: p.id })}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <span className="label">الموضوع</span>
        <div className="flex flex-wrap gap-2">
          {TOPICS.map(([k, l]) => (
            <button type="button" key={k} className={`toggle ${t.topic.type === k ? "toggle-on" : ""}`} onClick={() => topic({ type: k })}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {t.topic.type === "custom" && (
        <div className="flex flex-wrap gap-2">
          {SECTIONS.filter((c) => ["anime", "series", "movie", "game", "manga", "vn"].includes(c)).map((c) => {
            const on = t.topic.categories?.includes(c);
            return (
              <button type="button" key={c} className={`toggle ${on ? "toggle-on" : ""}`} onClick={() => topic({ categories: on ? t.topic.categories!.filter((x) => x !== c) : [...(t.topic.categories ?? []), c] })}>
                {SECTION_AR[c]}
              </button>
            );
          })}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="من سنة" value={t.topic.yearFrom ?? ""} onChange={(v) => topic({ yearFrom: v ? Number(v) : null })} num />
        <Field label="إلى سنة" value={t.topic.yearTo ?? ""} onChange={(v) => topic({ yearTo: v ? Number(v) : null })} num />
        <label className="block space-y-1.5">
          <span className="label">الموسم</span>
          <select className="field" value={t.topic.season ?? ""} onChange={(e) => topic({ season: e.target.value || undefined })}>
            <option value="">أي موسم</option>
            <option value="WINTER">شتاء</option>
            <option value="SPRING">ربيع</option>
            <option value="SUMMER">صيف</option>
            <option value="FALL">خريف</option>
          </select>
        </label>
        <Field label="الاستوديو" value={t.topic.studio ?? ""} onChange={(v) => topic({ studio: v || undefined })} />
        <Field label="التصنيف (Genre)" value={t.topic.genre ?? ""} onChange={(v) => topic({ genre: v || undefined })} />
        <Field label="الوسم (Tag)" value={t.topic.tag ?? ""} onChange={(v) => topic({ tag: v || undefined })} />
        <label className="block space-y-1.5">
          <span className="label">طبقة الشهرة</span>
          <select className="field" value={t.topic.popTier ?? ""} onChange={(e) => topic({ popTier: (e.target.value || "") as TierSettings["topic"]["popTier"] })}>
            <option value="">الكل</option>
            <option value="mainstream">مشهور</option>
            <option value="mid">متوسط</option>
            <option value="hidden_gem">مظلوم</option>
            <option value="obscure">مغمور</option>
          </select>
        </label>
      </div>
      <div className="space-y-1.5">
        <span className="label">مصدر العناصر</span>
        <Segmented
          value={t.source}
          onChange={(v) => up({ source: v })}
          options={[
            { value: "any", label: "أي شي" },
            { value: "someone", label: "شافه واحد منا" },
            { value: "everyone", label: "شافه الكل" },
            { value: "manual", label: "أختارها بنفسي" },
          ]}
        />
      </div>
      {t.source === "manual" && <ManualPicker ids={t.manual} onChange={(manual) => up({ manual })} kind={t.topic.type === "character" ? "character" : ["opening", "ending", "ost"].includes(t.topic.type) ? "song" : "work"} />}
    </div>
  );
}

function Field({ label, value, onChange, num }: { label: string; value: string | number; onChange: (v: string) => void; num?: boolean }) {
  return (
    <label className="block space-y-1.5">
      <span className="label">{label}</span>
      <input className={`field ${num ? "num" : ""}`} type={num ? "number" : "text"} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

const PREFIX: Record<AcKind, string> = { work: "w:", character: "c:", song: "t:" };

/** Search the library and pick items by hand. */
function ManualPicker({ ids, onChange, kind }: { ids: string[]; onChange: (ids: string[]) => void; kind: AcKind }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Suggestion[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let off = false;
    if (!q.trim()) return setRes([]);
    void loadIndex(kind).then((idx) => !off && setRes(suggest(idx, q, 8).filter((x) => kind !== "song" || x.id.startsWith("song:"))));
    return () => {
      off = true;
    };
  }, [q, kind]);
  const idOf = (sId: string) => PREFIX[kind] + (kind === "song" ? sId.slice(5) : sId);
  return (
    <div className="space-y-2">
      <input className="field" placeholder="ابحث وأضف (بالعربي أو الإنجليزي)" value={q} onChange={(e) => setQ(e.target.value)} />
      {res.length > 0 && (
        <ul className="divide-y divide-line rounded-sm border border-line">
          {res.map((r) => {
            const id = idOf(r.id);
            const on = ids.includes(id);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-surface"
                  onClick={() => {
                    setNames((n) => ({ ...n, [id]: r.labelAr || r.label }));
                    onChange(on ? ids.filter((x) => x !== id) : [...ids, id].slice(0, 60));
                  }}
                >
                  <Icon name={on ? "Check" : "Plus"} size={14} className={on ? "text-accent" : "text-muted"} />
                  {r.labelAr || r.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="num text-xs text-muted">
        {ids.length} مختار{ids.length ? ": " : ""}
        {ids.slice(0, 12).map((id) => names[id] ?? id.split(":").slice(1).join(":")).join("، ")}
        {ids.length > 12 ? "…" : ""}
      </p>
      {ids.length > 0 && (
        <button type="button" className="text-xs text-muted underline" onClick={() => onChange([])}>
          مسح الاختيار
        </button>
      )}
    </div>
  );
}
