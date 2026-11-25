import { endSession } from "@/lib/server/session";

export async function POST(req: Request) {
  await endSession();
  return Response.redirect(new URL("/login", req.url), 303);
}
