import { randomUUID, timingSafeEqual } from "node:crypto";
import { ADMIN_PASSWORD, GROUP_PASSWORD } from "@/lib/server/env";
import { getSession, startSession } from "@/lib/server/session";
import { getRepo } from "@/lib/server/repo";
import { AVATARS, COLORS } from "@/lib/identity";

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Group password + a name, a colour and an icon. No accounts. */
export async function POST(req: Request) {
  const f = await req.formData();
  const next = String(f.get("next") ?? "/");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const back = (e: string) => Response.redirect(new URL(`/login?e=${e}&next=${encodeURIComponent(safeNext)}`, req.url), 303);
  if (!GROUP_PASSWORD) return back("nopass");
  const pw = String(f.get("password") ?? "");
  const admin = !!ADMIN_PASSWORD && same(pw, ADMIN_PASSWORD);
  if (!admin && !same(pw, GROUP_PASSWORD)) return back("password");
  const name = String(f.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
  if (!name) return back("name");
  const color = COLORS.includes(String(f.get("color")) as never) ? String(f.get("color")) : COLORS[0];
  const avatar = AVATARS.includes(String(f.get("avatar")) as never) ? String(f.get("avatar")) : AVATARS[0];
  // same name again = the same player (keeps points and history); a new name = a new player
  const repo = getRepo();
  const users = await repo.listUsers();
  const existing = users.find((u) => u.name.toLowerCase() === name.toLowerCase());
  const current = await getSession();
  const uid = existing?.id ?? current?.uid ?? randomUUID();
  const isAdmin = admin || !!existing?.isAdmin || (!ADMIN_PASSWORD && users.length === 0);
  await startSession({ uid, name, color, avatar, admin: isAdmin });
  return Response.redirect(new URL(safeNext, req.url), 303);
}
