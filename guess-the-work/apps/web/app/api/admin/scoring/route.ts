import { adminApi } from "@/lib/server/admin";
import { getRepo } from "@/lib/server/repo";
import { DEFAULT_SCORING, type ScoringConfig } from "@gtw/core/scoring";

export const runtime = "nodejs";

/** Scoring numbers for new rooms (SPEC 11: all adjustable by the admin). */
export async function POST(req: Request) {
  const a = await adminApi();
  if (a instanceof Response) return a;
  const b = (await req.json()) as Partial<ScoringConfig> | { reset: true };
  const repo = getRepo();
  if ("reset" in b) {
    await repo.setSetting("scoring", DEFAULT_SCORING);
    return Response.json(DEFAULT_SCORING);
  }
  const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const c: ScoringConfig = {
    ...DEFAULT_SCORING,
    base: n(b.base, DEFAULT_SCORING.base),
    tier: { mainstream: n(b.tier?.mainstream, 1), mid: n(b.tier?.mid, 1.25), hidden_gem: n(b.tier?.hidden_gem, 1.5), obscure: n(b.tier?.obscure, 1.75) },
    slowest: n(b.slowest, 0.5),
    choice: n(b.choice, 0.5),
    autocompleteReduced: n(b.autocompleteReduced, 0.75),
    hintCosts: { first4: n(b.hintCosts?.first4, 0.1), next3: n(b.hintCosts?.next3, 0.15), last: n(b.hintCosts?.last, 0.25) },
    hintFloor: n(b.hintFloor, 0.2),
    streakStep: n(b.streakStep, 0.1),
    streakMax: n(b.streakMax, 0.5),
    rankBonus: [n(b.rankBonus?.[0], 50), n(b.rankBonus?.[1], 25), n(b.rankBonus?.[2], 10)],
    helperShare: n(b.helperShare, 0.4),
  };
  await repo.setSetting("scoring", c);
  return Response.json(c);
}
