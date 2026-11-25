import { apiUser } from "@/lib/server/session";
import { getBus } from "@/lib/server/bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-Sent Events: "update" when the room changes; the page then fetches its own view. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const u = await apiUser();
  if (u instanceof Response) return u;
  const { code } = await ctx.params;
  const enc = new TextEncoder();
  let unsub = () => {};
  let ping: NodeJS.Timeout;
  const stream = new ReadableStream({
    start(ctrl) {
      const send = (ev: string) => ctrl.enqueue(enc.encode(`event: ${ev}\ndata: {}\n\n`));
      send("hello");
      unsub = getBus().subscribe(code.toUpperCase(), (ev) => {
        try {
          send(ev);
        } catch {
          unsub();
        }
      });
      ping = setInterval(() => {
        try {
          ctrl.enqueue(enc.encode(`: ping\n\n`));
        } catch {
          clearInterval(ping);
        }
      }, 15_000);
      req.signal.addEventListener("abort", () => {
        unsub();
        clearInterval(ping);
        try {
          ctrl.close();
        } catch {}
      });
    },
    cancel() {
      unsub();
      clearInterval(ping);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
