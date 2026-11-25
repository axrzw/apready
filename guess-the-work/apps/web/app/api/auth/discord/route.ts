import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { authorizeUrl } from "@/lib/discord";
import { discord, SITE_URL } from "@/lib/server/env";

export async function GET() {
  if (!discord.clientId) return new Response("Discord is not configured (DISCORD_CLIENT_ID)", { status: 503 });
  const state = randomBytes(16).toString("hex");
  (await cookies()).set("gtw_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return Response.redirect(authorizeUrl(discord, `${SITE_URL}/api/auth/discord/callback`, state));
}
