import "server-only";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Http } from "@gtw/ingest/http";
import type { Repo } from "@gtw/db";
import { SOURCES, type Bundle, type Source, type SourceInfo, type SourceState } from "../sources-def";
import { getRepo } from "./repo";
import { invalidateLibrary } from "./library";

export { SOURCES };
const KEY = (id: string) => `source:${id}`;

function freshState(src: Source): SourceState {
  return { cursor: 0, total: src.total(process.env), added: 0, status: "idle", seed: Date.now() % 1_000_000, at: Date.now() };
}

export async function listSources(): Promise<SourceInfo[]> {
  const repo = getRepo();
  return Promise.all(
    SOURCES.map(async (s) => ({
      id: s.id,
      label: s.label,
      env: s.env,
      missing: s.env.filter((e) => !process.env[e]),
      state: (await repo.getSetting<SourceState>(KEY(s.id))) ?? freshState(s),
    })),
  );
}

async function save(repo: Repo, bundles: Bundle[]) {
  if (!bundles.length) return;
  await repo.upsertWorks(bundles.map((b) => b.work));
  await repo.upsertCharacters(bundles.flatMap((b) => b.characters));
  const people = new Map(bundles.flatMap((b) => b.people).map((p) => [p.id, p]));
  await repo.upsertPeople([...people.values()]);
}

/**
 * Runs steps of one source for up to `budgetMs`, saving the cursor after each step.
 * `restart` begins a new pull (new random sample).
 */
export async function stepSource(id: string, opts: { budgetMs?: number; restart?: boolean } = {}): Promise<SourceState> {
  const src = SOURCES.find((s) => s.id === id);
  if (!src) throw new Error("unknown source");
  const missing = src.env.filter((e) => !process.env[e]);
  if (missing.length) throw new Error(`ينقص: ${missing.join("، ")}`);
  const repo = getRepo();
  let st = (await repo.getSetting<SourceState>(KEY(id))) ?? freshState(src);
  if (opts.restart || st.status === "done") st = freshState(src);
  const http = new Http({ cacheDir: join(tmpdir(), "gtw-http"), ttlMs: 86_400_000, retries: 3 });
  const end = Date.now() + (opts.budgetMs ?? 40_000);
  st.status = "running";
  try {
    while (Date.now() < end && (st.total === 0 || st.cursor < st.total)) {
      const r = await src.run(http, st.cursor, st.seed, process.env, repo);
      await save(repo, r.bundles);
      st.added += r.bundles.length;
      st.cursor = r.next;
      st.total = Math.max(r.total, st.cursor);
      st.at = Date.now();
      await repo.setSetting(KEY(id), st);
      if (st.cursor >= st.total) break;
    }
    if (st.cursor >= st.total) st.status = "done";
    delete st.error;
  } catch (e) {
    st.status = "error";
    st.error = (e as Error).message.slice(0, 300);
  }
  await repo.setSetting(KEY(id), st);
  invalidateLibrary();
  return st;
}
