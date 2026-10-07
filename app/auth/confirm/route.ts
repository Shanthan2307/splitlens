import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { otpTypeSchema, safeNextPath } from "@/lib/validation/auth";

/**
 * Magic-link landing. Two link formats arrive here:
 * - custom template (`token_hash` + `type`): verified server-side, works in any browser/device;
 * - Supabase's default template (`code`, PKCE): used until custom SMTP allows editing templates.
 *   Only works in the browser that requested the link (the code verifier is in its cookies).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const code = searchParams.get("code");
  const type = otpTypeSchema.safeParse(searchParams.get("type"));
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash && type.success) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type.data });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  } else if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
