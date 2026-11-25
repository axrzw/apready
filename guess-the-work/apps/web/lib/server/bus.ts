import "server-only";
import { EventEmitter } from "node:events";

/**
 * Realtime bus. In-process (Server-Sent Events) for one server; with Supabase configured,
 * SupabaseBus also broadcasts on a Realtime channel so several servers / a Discord bot stay in sync.
 * Messages carry no secrets: just "room X changed"; each client then fetches its own view.
 */
export interface RealtimeBus {
  publish(room: string, event: string): void;
  subscribe(room: string, fn: (event: string) => void): () => void;
}

class InProcBus implements RealtimeBus {
  private em = new EventEmitter();
  constructor() {
    this.em.setMaxListeners(1000);
  }
  publish(room: string, event: string) {
    this.em.emit(room, event);
  }
  subscribe(room: string, fn: (event: string) => void) {
    this.em.on(room, fn);
    return () => void this.em.off(room, fn);
  }
}

const g = globalThis as unknown as { __gtwBus?: RealtimeBus };

export function getBus(): RealtimeBus {
  if (!g.__gtwBus) {
    g.__gtwBus = new InProcBus();
  }
  return g.__gtwBus;
}
