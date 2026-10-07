import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { splitwiseConfig } from "@/lib/env.server";
import { authorizeUrl } from "@/lib/splitwise/api";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/validation/auth";
import { STATE_COOKIE, STATE_COOKIE_PATH, splitwiseRedirectUri } from "../oauth-state";

/** Starts Splitwise OAuth: random state in an httpOnly cookie, then off to Splitwise's consent screen. */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent("/import/splitwise")}`);

  const config = splitwiseConfig();
  if (!config) return NextResponse.redirect(`${origin}/import/splitwise?error=not_configured`);

  const state = randomBytes(24).toString("hex");
  const next = safeNextPath(searchParams.get("next") ?? "/import/splitwise");
  const response = NextResponse.redirect(
    authorizeUrl({ clientId: config.clientId, redirectUri: await splitwiseRedirectUri(), state }),
  );
  response.cookies.set(STATE_COOKIE, `${state}.${encodeURIComponent(next)}`, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: STATE_COOKIE_PATH,
    maxAge: 600,
  });
  return response;
}
