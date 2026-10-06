import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60svh] max-w-md flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="text-sm text-muted-foreground">
        This page doesn&apos;t exist, or you don&apos;t have access to it (for example, a group you&apos;ve left).
      </p>
      <Button asChild>
        <Link href="/dashboard">Go to dashboard</Link>
      </Button>
    </main>
  );
}
