import { SITE_URL } from "@/lib/server/env";
import { endSession } from "@/lib/server/session";

export async function POST() {
  await endSession();
  return Response.redirect(`${SITE_URL}/login`, 303);
}
