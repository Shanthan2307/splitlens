import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Sign in · SplitLens" };

const ERRORS: Record<string, string> = {
  oauth: "Google sign-in could not be started. Try again.",
  callback: "Sign-in didn't complete. Try again.",
  link: "That sign-in link is invalid or has expired. Request a new one.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">SplitLens</CardTitle>
          <CardDescription>Sign in to split expenses with friends and groups.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error && ERRORS[error] && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {ERRORS[error]}
            </p>
          )}
          <LoginForm next={next} />
        </CardContent>
      </Card>
    </main>
  );
}
