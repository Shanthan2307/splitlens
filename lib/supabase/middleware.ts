import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/db/database.types";
import { publicEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/login", "/auth/"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

/** Refreshes the Supabase auth session cookie and gates app routes behind sign-in. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = publicEnv();

  const supabase = createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Do not run code between client creation and getClaims(): it revalidates the session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  // API routes authenticate themselves and answer 401 instead of redirecting.
  if (!signedIn && !isPublicPath(pathname) && !pathname.startsWith("/api/")) {
    return redirectPreservingCookies(request, response, "/login", pathname === "/" ? undefined : pathname + search);
  }
  if (signedIn && pathname === "/login") {
    return redirectPreservingCookies(request, response, "/dashboard");
  }
  return response;
}

function redirectPreservingCookies(request: NextRequest, response: NextResponse, to: string, next?: string) {
  const url = request.nextUrl.clone();
  url.pathname = to;
  url.search = next ? `?next=${encodeURIComponent(next)}` : "";
  const redirect = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}
