import "server-only";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

export const DATA_DIR = process.env.GTW_DATA_DIR || resolve(process.cwd(), "..", "..", "data");
export const MEDIA_DIR = process.env.GTW_MEDIA_DIR || join(DATA_DIR, "media");


/** One password for the whole group. In development it defaults to "dev". */
export const GROUP_PASSWORD = process.env.GROUP_PASSWORD || (process.env.NODE_ENV === "production" ? "" : "dev");
/** Optional: logging in with this password makes you admin. Without it, the first player is the admin. */
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
/** Cookie signing key: SESSION_SECRET, else derived from the group password (changing it logs everybody out). */
export const SESSION_SECRET = process.env.SESSION_SECRET || createHash("sha256").update(`gtw-session|${GROUP_PASSWORD}`).digest("hex");
