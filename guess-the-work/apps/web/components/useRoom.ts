"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicRoom } from "@gtw/core/room";
import type { PublicQuestion } from "@gtw/core/questions";

export type View = PublicRoom<PublicQuestion>;

/** Live room: SSE for "something changed" + a slow poll as a safety net. Clock synced to the server. */
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

  useEffect(() => {
    load();
    const es = new EventSource(`/api/rooms/${code}/stream`);
    es.addEventListener("update", () => load());
    const poll = setInterval(load, 4000);
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [code, load]);

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
