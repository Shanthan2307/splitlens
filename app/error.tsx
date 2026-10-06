"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Errors outside the signed-in shell (login, auth callbacks, invite landing). */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main role="alert" className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-4 text-center">
      <AlertTriangle className="size-10 text-destructive" aria-hidden />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          Please try again.
          {error.digest && <span className="mt-1 block font-mono text-xs">Ref: {error.digest}</span>}
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    </main>
  );
}
