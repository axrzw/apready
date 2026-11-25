import { NextResponse, type NextRequest } from "next/server";

/** Private site: everything needs a session cookie (checked properly on the server). */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // /api/cron: Vercel cron (CRON_SECRET), /api/test: E2E only (E2E_SECRET); both check their own secret
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth") || pathname.startsWith("/api/cron") || pathname.startsWith("/api/test") || pathname === "/robots.txt") return NextResponse.next();
  if (!req.cookies.get("gtw_session")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "login" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // invite links (/room/CODE) come back here after the password
    url.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
