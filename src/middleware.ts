import { NextResponse, type NextRequest } from "next/server";

/** Cheap gate: no session cookie → login. Real session validation happens on the server for every page/action/API. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/_next") || pathname === "/favicon.ico" || pathname.startsWith("/api/logo")) return NextResponse.next();
  if (!req.cookies.get("sfms_session")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
