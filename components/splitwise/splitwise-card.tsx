import { ArrowRightLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConnectionStatus } from "@/lib/db/splitwise";
import { DisconnectSplitwiseButton } from "./disconnect-button";

/** Account settings: connect, open the importer, or disconnect. */
export function SplitwiseCard({ configured, connection }: { configured: boolean; connection: ConnectionStatus | null }) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowRightLeft className="size-4" aria-hidden /> Splitwise
        </CardTitle>
        <CardDescription>
          {connection
            ? connection.syncError === "reconnect"
              ? "Splitwise stopped accepting SplitLens's access. Reconnect to keep importing."
              : `Connected${connection.lastSyncedAt ? ` · last import ${new Date(connection.lastSyncedAt).toLocaleDateString()}` : ""}`
            : configured
              ? "Bring your Splitwise groups, friends and history into SplitLens."
              : "The Splitwise integration isn't set up on this server yet."}
        </CardDescription>
      </CardHeader>
      {configured && (
        <CardContent className="flex flex-wrap items-center gap-2">
          {connection && connection.syncError !== "reconnect" ? (
            <>
              <Button asChild>
                <Link href="/import/splitwise">Import from Splitwise</Link>
              </Button>
              <DisconnectSplitwiseButton />
            </>
          ) : (
            <Button asChild>
              {/* A route handler (not a page): prefetching would start OAuth. */}
              <a href="/api/splitwise/connect">{connection ? "Reconnect Splitwise" : "Connect Splitwise"}</a>
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}
