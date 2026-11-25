import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_SECRET } from "./env";
import { getRepo } from "./repo";

export const COOKIE = "gtw_session";
const MAX_AGE = 60 * 60 * 24 * 365;

export interface Session {
  uid: string;
  name: string;
  color?: string;
  avatar?: string;
  admin?: boolean;
  exp: number;
}

function sign(data: string) {
  return createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
}

export function encodeSession(s: Omit<Session, "exp">, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...s, exp: now + MAX_AGE * 1000 })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSession(token: string | undefined, now = Date.now()): Session | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
    return s.exp > now ? s : null;
  } catch {
    return null;
  }
}

const kickedCache = new Map<string, { at: number; kicked: boolean; admin: boolean }>();

/** The signed cookie, and the player is not kicked (checked against the db, cached 20 s). */
export async function getSession(): Promise<Session | null> {
  const s = decodeSession((await cookies()).get(COOKIE)?.value);
  if (!s) return null;
  let c = kickedCache.get(s.uid);
  if (!c || Date.now() - c.at > 20_000) {
    const u = await getRepo().getUser(s.uid);
    c = { at: Date.now(), kicked: !u || !!u.kicked, admin: !!u?.isAdmin };
    kickedCache.set(s.uid, c);
  }
  if (c.kicked) return null;
  return { ...s, admin: c.admin };
}

export async function requireUser(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

export async function requireAdmin(): Promise<Session> {
  const s = await requireUser();
  if (!s.admin) redirect("/");
  return s;
}

export async function startSession(s: Omit<Session, "exp">) {
  await getRepo().upsertUser({ id: s.uid, name: s.name, color: s.color, avatar: s.avatar, isAdmin: s.admin, kicked: false });
  kickedCache.delete(s.uid);
  (await cookies()).set(COOKIE, encodeSession(s), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

/** For API routes: the user or a 401 response. */
export async function apiUser(): Promise<Session | Response> {
  const s = await getSession();
  return s ?? Response.json({ error: "login" }, { status: 401 });
}
