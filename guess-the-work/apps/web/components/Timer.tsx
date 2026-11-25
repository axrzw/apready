"use client";
import { useEffect, useRef } from "react";
import { play } from "@/lib/sound";
import { useTick } from "./useRoom";

/** Thin bar + seconds. Ticks softly in the last five seconds. */
export default function Timer({ start, end, now }: { start: number; end: number | null; now: () => number }) {
  useTick(200);
  const last = useRef(-1);
  const left = end ? Math.max(0, end - now()) : 0;
  const secs = Math.ceil(Math.min(left, (end ?? start) - start) / 1000);
  useEffect(() => {
    if (end && secs <= 5 && secs > 0 && secs !== last.current) play("tick");
    last.current = secs;
  }, [secs, end]);
  if (!end) return null;
  const frac = end - start > 0 ? Math.min(1, left / (end - start)) : 0;
  const low = frac < 0.25;
  return (
    <div className="flex items-center gap-3" role="timer" aria-live="off">
      <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-line">
        <div className={`h-full transition-[width] duration-200 ease-linear ${low ? "bg-signal" : "bg-accent"}`} style={{ width: `${frac * 100}%` }} />
      </div>
      <span className={`num w-8 text-end font-display text-lg ${low ? "text-signal" : "text-text"}`}>{secs}</span>
    </div>
  );
}
