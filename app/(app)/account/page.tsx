import type { Metadata } from "next";
import { AccountForm } from "@/components/account/account-form";
import { PageHeader } from "@/components/shell/page-header";
import { requireUser } from "@/lib/auth";
import { isCurrencyCode } from "@/lib/currencies";
import { getProfile } from "@/lib/db/profiles";
import { isLanguageTag } from "@/lib/languages";

export const metadata: Metadata = { title: "Account · SplitLens" };

export default async function AccountPage() {
  const { user, supabase } = await requireUser();
  const profile = await getProfile(supabase, user.id);

  return (
    <>
      <PageHeader title="Account" description="Your name, photo and preferences." />
      <AccountForm
        profile={{
          displayName: profile.display_name,
          email: profile.email,
          avatarUrl: profile.avatar_url,
          defaultCurrency: isCurrencyCode(profile.default_currency) ? profile.default_currency : "USD",
          preferredLanguage: isLanguageTag(profile.preferred_language) ? profile.preferred_language : "en",
          venmoUsername: profile.venmo_username ?? "",
          paypalUsername: profile.paypal_username ?? "",
        }}
      />
    </>
  );
}
