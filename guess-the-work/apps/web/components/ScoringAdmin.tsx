"use client";
import { useState } from "react";
import type { ScoringConfig } from "@gtw/core/scoring";

const FIELDS: [string, string][] = [
  ["base", "الأساس"],
  ["tier.mainstream", "معامل المشهور"],
  ["tier.mid", "معامل المتوسط"],
  ["tier.hidden_gem", "معامل المظلوم"],
  ["tier.obscure", "معامل المغمور"],
  ["slowest", "السرعة عند نهاية الوقت"],
  ["choice", "اختيار من ٤"],
  ["autocompleteReduced", "الإكمال بنقاط أقل"],
  ["hintCosts.first4", "تلميح ١–٤"],
  ["hintCosts.next3", "تلميح ٥–٧"],
  ["hintCosts.last", "آخر تلميح"],
  ["hintFloor", "حد أدنى بعد التلميحات"],
  ["streakStep", "السلسلة لكل صح"],
  ["streakMax", "أقصى سلسلة"],
  ["rankBonus.0", "مكافأة الأول"],
  ["rankBonus.1", "مكافأة الثاني"],
  ["rankBonus.2", "مكافأة الثالث"],
  ["helperShare", "نصيب الواصف/الرسام"],
];

const get = (o: unknown, path: string) => path.split(".").reduce((x: unknown, k) => (x as Record<string, unknown>)?.[k], o) as number;
function setPath(o: ScoringConfig, path: string, v: number): ScoringConfig {
  const c = structuredClone(o) as unknown as Record<string, unknown>;
  const keys = path.split(".");
  let cur = c;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[keys.at(-1)!] = v;
  return c as unknown as ScoringConfig;
}

/** Scoring numbers for new rooms. */
export default function ScoringAdmin({ initial }: { initial: ScoringConfig }) {
  const [c, setC] = useState(initial);
  const [msg, setMsg] = useState("");
  const save = async (body: unknown) => {
    const r = await fetch("/api/admin/scoring", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setC(await r.json());
    setMsg("انحفظ للغرف الجديدة");
  };
  return (
    <section className="panel space-y-3 p-4">
      <h2 className="font-display text-lg">النقاط</h2>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {FIELDS.map(([k, label]) => (
          <label key={k} className="block space-y-1">
            <span className="text-xs text-muted">{label}</span>
            <input type="number" step="0.05" className="field num h-9" value={get(c, k)} onChange={(e) => setC(setPath(c, k, Number(e.target.value)))} />
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button className="btn-primary h-9" onClick={() => save(c)}>
          حفظ
        </button>
        <button className="btn-quiet h-9 border border-line" onClick={() => save({ reset: true })}>
          القيم الافتراضية
        </button>
        {msg && <span className="self-center text-xs text-ok">{msg}</span>}
      </div>
    </section>
  );
}
