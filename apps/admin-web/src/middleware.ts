import { NextResponse, type NextRequest } from "next/server";
import { isDevLoginEnabledOnServer } from "@/lib/dev-mode";

/** A path no route matches: rewriting to it renders the app's own Arabic 404 page with a real 404 status. */
export const DEV_PAGE_UNAVAILABLE_PATH = "/dev/__unavailable";

/**
 * Test-only pages under /dev (the worker simulator) exist only while the API
 * is in dev login mode -- the same signal the login page uses. Otherwise they
 * answer exactly like a URL that does not exist. This runs before rendering,
 * so the status is a real 404 (a page-level `notFound()` after an await
 * comes too late once Next has started streaming the response).
 */
export async function middleware(request: NextRequest) {
  if (await isDevLoginEnabledOnServer()) return NextResponse.next();
  return NextResponse.rewrite(new URL(DEV_PAGE_UNAVAILABLE_PATH, request.url));
}

export const config = { matcher: ["/dev/:path*"] };
