import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { SplitwiseCard } from "@/components/splitwise/splitwise-card";
import { requireUser } from "@/lib/auth";
import { getConnectionStatus } from "@/lib/db/splitwise";
import { splitwiseConfig } from "@/lib/env.server";

export const metadata: Metadata = { title: "Import from Splitwise · SplitLens" };

const MESSAGES: Record<string, string> = {
  connected: "Splitwise connected.",
  denied: "Splitwise access wasn't granted.",
  failed: "Couldn't connect Splitwise. Try again.",
};

export default async function ImportSplitwisePage({
  searchParams,
}: {
  searchParams: Promise<{ splitwise?: string; reason?: string; error?: string }>;
}) {
  const { user, supabase } = await requireUser();
  const params = await searchParams;
  const configured = splitwiseConfig() !== null;
  const connection = await getConnectionStatus(supabase, user.id);
  const notice = params.reason ?? (params.splitwise ? MESSAGES[params.splitwise] : undefined);

  return (
    <>
      <PageHeader title="Import from Splitwise" description="Bring your groups, friends and balances over." />
      {notice && (
        <p role="status" className="mb-4 rounded-md border bg-muted/40 p-3 text-sm">
          {notice}
        </p>
      )}
      <SplitwiseCard configured={configured} connection={connection} />
    </>
  );
}
