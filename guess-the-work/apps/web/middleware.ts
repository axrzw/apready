import { NextResponse, type NextRequest } from "next/server";

/** Private site: everything needs a session cookie (checked properly on the server). */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth") || pathname === "/robots.txt") return NextResponse.next();
  if (!req.cookies.get("gtw_session")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "login" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
