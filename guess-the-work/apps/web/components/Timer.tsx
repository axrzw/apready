"use client";
import { useTick } from "./useRoom";

export default function Timer({ start, end, now }: { start: number; end: number | null; now: () => number }) {
  useTick(200);
  if (!end) return null;
  const total = end - start;
  const left = Math.max(0, end - now());
  const frac = total > 0 ? left / total : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-700">
        <div className={`h-full transition-[width] duration-200 ${frac < 0.25 ? "bg-rose-500" : "bg-brand-500"}`} style={{ width: `${frac * 100}%` }} />
      </div>
      <span className="w-10 text-center font-mono tabular-nums">{Math.ceil(left / 1000)}</span>
    </div>
  );
}
