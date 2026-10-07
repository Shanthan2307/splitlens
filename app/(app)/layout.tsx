import Link from "next/link";
import { BottomNav, SidebarNav } from "@/components/shell/app-nav";
import { UserMenu } from "@/components/shell/user-menu";
import { UserPrefsProvider } from "@/components/user-prefs";
import { requireUser } from "@/lib/auth";
import { isLanguageTag } from "@/lib/languages";
import { getProfile } from "@/lib/db/profiles";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, supabase } = await requireUser();
  const profile = await getProfile(supabase, user.id);

  const prefs = {
    preferredLanguage: isLanguageTag(profile.preferred_language)
      ? profile.preferred_language
      : ("en" as const),
    defaultCurrency: profile.default_currency,
  };

  return (
    <UserPrefsProvider value={prefs}>
      <div className="min-h-svh md:grid md:grid-cols-[220px_1fr]">
        <aside className="hidden border-r bg-muted/30 p-4 md:flex md:flex-col md:gap-6">
          <Link
            href="/dashboard"
            className="px-3 text-lg font-semibold tracking-tight"
          >
            SplitLens
          </Link>
          <SidebarNav />
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center pt-[env(safe-area-inset-top)] justify-between border-b bg-background/95 px-4 backdrop-blur md:justify-end">
            <Link
              href="/dashboard"
              className="text-lg font-semibold tracking-tight md:hidden"
            >
              SplitLens
            </Link>
            <UserMenu
              name={profile.display_name || "You"}
              email={profile.email}
              avatarUrl={profile.avatar_url}
            />
          </header>
          <main className="mx-auto w-full max-w-4xl flex-1 p-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:p-8">
            {children}
          </main>
        </div>

        <BottomNav />
      </div>
    </UserPrefsProvider>
  );
}
