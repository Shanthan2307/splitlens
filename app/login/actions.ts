"use server";

import { redirect } from "next/navigation";
import { siteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { magicLinkSchema, safeNextPath } from "@/lib/validation/auth";

export type MagicLinkState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

export async function sendMagicLink(_prev: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const parsed = magicLinkSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Invalid email" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: true,
      // The email template links to {{ .RedirectTo }}&token_hash=…, landing on /auth/confirm.
      emailRedirectTo: `${await siteUrl()}/auth/confirm?next=${encodeURIComponent(safeNextPath(parsed.data.next))}`,
    },
  });
  if (error) return { status: "error", message: "Could not send the sign-in link. Try again shortly." };
  return { status: "sent", email: parsed.data.email };
}

export async function signInWithGoogle(formData: FormData) {
  const next = safeNextPath(formData.get("next")?.toString());
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${await siteUrl()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect("/login?error=oauth");
  redirect(data.url);
}
