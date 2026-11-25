import { devLoginEnabled, SITE_URL } from "@/lib/server/env";
import { startSession } from "@/lib/server/session";

/** Development login without any keys: type a name. */
export async function POST(req: Request) {
  if (!devLoginEnabled) return new Response("dev login is off", { status: 403 });
  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim().slice(0, 32);
  if (!name) return Response.redirect(`${SITE_URL}/login?e=name`, 303);
  const slug = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-");
  await startSession({ uid: `dev:${slug}`, name, admin: form.get("admin") === "on" });
  return Response.redirect(`${SITE_URL}/`, 303);
}
