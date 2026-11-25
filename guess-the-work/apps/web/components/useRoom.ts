"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicRoom } from "@gtw/core/room";
import type { PublicQuestion } from "@gtw/core/questions";

export type View = PublicRoom<PublicQuestion>;

/** Live room by polling. Clock synced to the server (offset from the round trip). */
export function useRoom(code: string) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offset = useRef(0);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const t0 = Date.now();
      const r = await fetch(`/api/rooms/${code}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) return setError(j.error ?? "error");
      offset.current = j.serverNow - (t0 + Date.now()) / 2;
      setView(j);
      setError(null);
    } catch {
      /* offline for a moment */
    } finally {
      busy.current = false;
    }
  }, [code]);

  // light polling (no websockets on serverless): faster while a question runs
  const phase = view?.phase;
  useEffect(() => {
    load();
    const ms = phase === "lobby" || phase === "finished" ? 2000 : phase === "question" || phase?.startsWith("describe_turn") || phase === "draw_guess" ? 700 : 1000;
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, ms);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [code, load, phase]);

  const act = useCallback(
    async (action: Record<string, unknown>) => {
      const r = await fetch(`/api/rooms/${code}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error ?? "error");
        return null;
      }
      if (j.view) setView(j.view);
      return j.result;
    },
    [code],
  );

  const now = useCallback(() => Date.now() + offset.current, []);
  return { view, error, act, now, reload: load, setError };
}

/** Re-render every `ms` (timers). */
export function useTick(ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    const i = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(i);
  }, [ms]);
}
