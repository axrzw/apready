import { cookies } from "next/headers";
import { avatarUrl, exchangeCode, fetchMe, isAllowed } from "@/lib/discord";
import { discord, SITE_URL } from "@/lib/server/env";
import { startSession } from "@/lib/server/session";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const state = jar.get("gtw_oauth_state")?.value;
  jar.delete("gtw_oauth_state");
  if (!state || url.searchParams.get("state") !== state) return Response.redirect(`${SITE_URL}/login?e=state`);
  const code = url.searchParams.get("code");
  if (!code) return Response.redirect(`${SITE_URL}/login?e=code`);
  try {
    const token = await exchangeCode(discord, code, `${SITE_URL}/api/auth/discord/callback`);
    const { user, guilds } = await fetchMe(token, !!discord.guildId);
    if (!isAllowed(discord, user, guilds)) return Response.redirect(`${SITE_URL}/login?e=notallowed`);
    await startSession({ uid: `discord:${user.id}`, name: user.global_name || user.username, avatar: avatarUrl(user), admin: discord.admins.includes(user.id) });
    return Response.redirect(`${SITE_URL}/`);
  } catch {
    return Response.redirect(`${SITE_URL}/login?e=discord`);
  }
}
