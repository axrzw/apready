import "server-only";
import { resolve, join } from "node:path";

export const DATA_DIR = process.env.GTW_DATA_DIR || resolve(process.cwd(), "..", "..", "data");
export const DB_PATH = process.env.GTW_DB_PATH || join(DATA_DIR, "gtw.sqlite");
export const MEDIA_DIR = process.env.GTW_MEDIA_DIR || join(DATA_DIR, "media");
export const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-secret-change-me";
export const SITE_URL = process.env.SITE_URL || "http://localhost:3000";

export const discord = {
  clientId: process.env.DISCORD_CLIENT_ID || "",
  clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
  /** Discord user ids allowed in (comma separated). Empty = nobody via Discord. */
  allowlist: (process.env.ALLOWED_DISCORD_IDS || "").split(",").map((s) => s.trim()).filter(Boolean),
  admins: (process.env.ADMIN_DISCORD_IDS || "").split(",").map((s) => s.trim()).filter(Boolean),
  guildId: process.env.ALLOWED_DISCORD_GUILD_ID || "",
};

/** Dev login (no keys needed) is on unless turned off, and always off when Discord is configured in production. */
export const devLoginEnabled = process.env.DEV_LOGIN === "1" || (process.env.DEV_LOGIN !== "0" && (!discord.clientId || process.env.NODE_ENV !== "production"));
