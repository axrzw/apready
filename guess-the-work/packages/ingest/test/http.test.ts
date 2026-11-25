import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Http } from "../src/http";

function fakeFetch(responses: (() => Response)[]) {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url: string) => {
      calls.push(url);
      return responses.shift()!();
    },
  };
}

describe("Http", () => {
  it("retries on 429 using Retry-After and then caches", async () => {
    const waits: number[] = [];
    const f = fakeFetch([
      () => new Response("slow down", { status: 429, headers: { "retry-after": "3" } }),
      () => Response.json({ ok: 1 }),
    ]);
    const dir = mkdtempSync(join(tmpdir(), "gtw-"));
    const http = new Http({ fetch: f.fetch, sleep: async (ms) => void waits.push(ms), cacheDir: dir, minIntervalMs: { "x.test": 0 } });
    expect(await http.json("https://x.test/a")).toEqual({ ok: 1 });
    expect(waits).toContain(3000);
    expect(await http.json("https://x.test/a")).toEqual({ ok: 1 });
    expect(f.calls.length).toBe(2);
  });
  it("does not retry a 404", async () => {
    const f = fakeFetch([() => new Response("nope", { status: 404 }), () => Response.json({})]);
    const http = new Http({ fetch: f.fetch, sleep: async () => {} });
    await expect(http.json("https://x.test/b")).rejects.toThrow(/404/);
    expect(f.calls.length).toBe(1);
  });
  it("spaces requests to the same host", async () => {
    const waits: number[] = [];
    const f = fakeFetch([() => Response.json(1), () => Response.json(2)]);
    const http = new Http({ fetch: f.fetch, sleep: async (ms) => void waits.push(ms), minIntervalMs: { "y.test": 5000 } });
    await http.json("https://y.test/1");
    await http.json("https://y.test/2");
    expect(waits.some((w) => w > 4000)).toBe(true);
  });
});
