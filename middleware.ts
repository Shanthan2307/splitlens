import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  try {
    return await updateSession(request);
  } catch (error) {
    // Misconfigured deployment (e.g. NEXT_PUBLIC_* env vars missing at build time):
    // say which setting is missing instead of an opaque MIDDLEWARE_INVOCATION_FAILED.
    if (error instanceof ZodError) {
      const missing = [...new Set(error.issues.map((i) => i.path.join(".")))].join(", ");
      console.error(`SplitLens configuration error: invalid or missing ${missing}`);
      return new NextResponse(
        `SplitLens is not configured: set ${missing} in the hosting environment variables, then redeploy.`,
        { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } },
      );
    }
    throw error;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
