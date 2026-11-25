import { listSources, stepSource } from "@/lib/server/sources";
import { getRepo } from "@/lib/server/repo";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Weekly (vercel.json crons): the current season, then a slice of every source that has its keys
 * (AniList sample favours hidden gems / obscure through its bands, TMDB/IGDB only with keys).
 * Vercel calls it with "Authorization: Bearer $CRON_SECRET".
 */
export async function GET(req: Request) {
  if (process.env.CRON_SECRET && req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("no", { status: 401 });
  const started = Date.now();
  const report: Record<string, unknown> = {};
  report.season = await stepSource("season", { restart: true, budgetMs: 40_000 });
  for (const s of await listSources()) {
    if (s.id === "season" || s.missing.length) continue;
    if (Date.now() - started > 230_000) break;
    report[s.id] = await stepSource(s.id, { budgetMs: 25_000, restart: s.state.status === "done" });
  }
  await getRepo().logJob("weekly", "done", JSON.stringify(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, (v as { added?: number }).added]))));
  return Response.json(report);
}
