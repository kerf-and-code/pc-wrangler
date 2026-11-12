import { updateSession } from "@/lib/supabase/proxy";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // The Discord Activity (push 34, audit P7): Discord opens the app's root URL mapping with a frame_id
  // in the query, so that load is the Activity page, not the landing page. It has no login cookies
  // (it runs on discordsays.com); app/activity signs in through Discord instead.
  if (request.nextUrl.pathname === "/" && request.nextUrl.searchParams.has("frame_id")) {
    const url = request.nextUrl.clone();
    url.pathname = "/activity";
    return NextResponse.rewrite(url);
  }
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
