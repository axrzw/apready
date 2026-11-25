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

class SupabaseBus extends InProcBus {
  private channels = new Map<string, { send: (m: unknown) => unknown }>();
  constructor(private client: { channel: (name: string) => { on: (...a: unknown[]) => unknown; subscribe: () => unknown; send: (m: unknown) => unknown } }) {
    super();
  }
  publish(room: string, event: string) {
    super.publish(room, event);
    let ch = this.channels.get(room);
    if (!ch) {
      const c = this.client.channel(`room:${room}`);
      c.subscribe();
      ch = c;
      this.channels.set(room, c);
    }
    void ch.send({ type: "broadcast", event: "update", payload: { event } });
  }
}

const g = globalThis as unknown as { __gtwBus?: RealtimeBus };

export function getBus(): RealtimeBus {
  if (!g.__gtwBus) {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.REALTIME === "supabase") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
      g.__gtwBus = new SupabaseBus(createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY) as never);
    } else g.__gtwBus = new InProcBus();
  }
  return g.__gtwBus;
}
