/** Discord OAuth2 (pure helpers, tested without network). */
export interface DiscordConfig {
  clientId: string;
  clientSecret: string;
  allowlist: string[];
  admins: string[];
  guildId: string;
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

export function authorizeUrl(cfg: DiscordConfig, redirectUri: string, state: string): string {
  const scope = cfg.guildId ? "identify guilds" : "identify";
  const q = new URLSearchParams({ client_id: cfg.clientId, response_type: "code", redirect_uri: redirectUri, scope, state, prompt: "none" });
  return `https://discord.com/oauth2/authorize?${q}`;
}

/** Allowed if the id is on the allowlist, or (when a server id is set) the user is in that Discord server. */
export function isAllowed(cfg: DiscordConfig, user: DiscordUser, guildIds: string[] = []): boolean {
  if (cfg.allowlist.includes(user.id) || cfg.admins.includes(user.id)) return true;
  return !!cfg.guildId && guildIds.includes(cfg.guildId);
}

export function avatarUrl(u: DiscordUser): string | undefined {
  return u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : undefined;
}

type F = (url: string, init?: RequestInit) => Promise<Response>;

export async function exchangeCode(cfg: DiscordConfig, code: string, redirectUri: string, f: F = fetch): Promise<string> {
  const res = await f("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  if (!res.ok) throw new Error(`discord token ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function fetchMe(token: string, withGuilds: boolean, f: F = fetch): Promise<{ user: DiscordUser; guilds: string[] }> {
  const h = { authorization: `Bearer ${token}` };
  const user = (await (await f("https://discord.com/api/users/@me", { headers: h })).json()) as DiscordUser;
  let guilds: string[] = [];
  if (withGuilds) guilds = ((await (await f("https://discord.com/api/users/@me/guilds", { headers: h })).json()) as { id: string }[]).map((g) => g.id);
  return { user, guilds };
}
