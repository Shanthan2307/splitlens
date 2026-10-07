import { NextResponse, type NextRequest } from "next/server";
import { userMessage } from "@/lib/db/client";
import { linkSplitwiseAccount, saveConnection } from "@/lib/db/splitwise";
import { splitwiseConfig } from "@/lib/env.server";
import { exchangeCode, SplitwiseApi } from "@/lib/splitwise/api";
import { encryptTokens } from "@/lib/splitwise/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/validation/auth";
import { readState, STATE_COOKIE, STATE_COOKIE_PATH, splitwiseRedirectUri } from "../oauth-state";

/**
 * Splitwise OAuth callback: checks state, exchanges the code, identifies the Splitwise user
 * with the new token (so the id is verified), stores encrypted tokens and links the account.
 */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const { ok, next } = readState(request.cookies.get(STATE_COOKIE)?.value, searchParams.get("state"));
  const back = (query: string) => {
    const response = NextResponse.redirect(`${origin}${safeNextPath(next ?? "/import/splitwise")}${query}`);
    response.cookies.set(STATE_COOKIE, "", { path: STATE_COOKIE_PATH, maxAge: 0 });
    return response;
  };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.redirect(`${origin}/login`);

  const code = searchParams.get("code");
  if (searchParams.get("error")) return back("?splitwise=denied");
  const config = splitwiseConfig();
  if (!ok || !code || !config) return back("?splitwise=failed");

  try {
    const token = await exchangeCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: await splitwiseRedirectUri(),
      code,
    });
    const me = await new SplitwiseApi(token.accessToken).getCurrentUser();
    const admin = createAdminClient();
    await linkSplitwiseAccount(admin, data.user.id, me.id);
    await saveConnection(admin, { userId: data.user.id, splitwiseUserId: me.id, scope: token.scope, ...encryptTokens(token, config) });
  } catch (error) {
    console.error("Splitwise connect failed", error instanceof Error ? error.message : error);
    const message = userMessage(error, "");
    return back(message ? `?splitwise=failed&reason=${encodeURIComponent(message)}` : "?splitwise=failed");
  }
  return back("?splitwise=connected");
}
