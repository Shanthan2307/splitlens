import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ExpenseDialog } from "@/components/expenses/expense-dialog";
import { friendExpenseContext } from "@/components/expenses/expense-context";
import { AddFriendForm } from "@/components/friends/add-friend-form";
import { CancelRequestButton, IncomingRequestActions } from "@/components/friends/request-actions";
import { BalanceList } from "@/components/money";
import { PersonAvatar } from "@/components/people/person-avatar";
import { EmptyState, PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { listFriendships } from "@/lib/db/friends";
import { loadUserLedger } from "@/lib/db/ledger";
import { getMe } from "@/lib/db/me";
import { friendBalances, userDebts } from "@/lib/splits";

export const metadata: Metadata = { title: "Friends · SplitLens" };

export default async function FriendsPage() {
  const { user, supabase } = await requireUser();
  const [me, friendships, ledger] = await Promise.all([
    getMe(supabase, user.id),
    listFriendships(supabase, user.id),
    loadUserLedger(supabase, user.id),
  ]);
  const balances = friendBalances(user.id, userDebts(ledger.groups, ledger.direct));
  const context = friendExpenseContext(me, friendships.friends, [], me.defaultCurrency);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <PageHeader title="Friends" description="People you split with, across all groups." />
        {friendships.friends.length > 0 && (
          <ExpenseDialog
            {...context}
            navigateToNew
            trigger={
              <Button>
                <Plus aria-hidden />
                Add expense
              </Button>
            }
          />
        )}
      </div>

      <AddFriendForm />

      {friendships.incoming.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Friend requests</h2>
          <ul className="divide-y rounded-lg border">
            {friendships.incoming.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                <PersonAvatar name={r.person.name} avatarUrl={r.person.avatarUrl} className="size-9" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.person.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.person.email}</p>
                </div>
                <IncomingRequestActions friendshipId={r.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {friendships.outgoing.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Sent requests</h2>
          <ul className="divide-y rounded-lg border">
            {friendships.outgoing.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                <PersonAvatar name={r.person.name} avatarUrl={r.person.avatarUrl} className="size-9" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.person.name}</p>
                  <p className="truncate text-xs text-muted-foreground">Waiting for them to accept</p>
                </div>
                <CancelRequestButton friendshipId={r.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Friends</h2>
        {friendships.friends.length === 0 ? (
          <EmptyState title="No friends yet">Add a friend by email, or add people to a group.</EmptyState>
        ) : (
          <ul className="divide-y rounded-lg border">
            {friendships.friends.map((f) => (
              <li key={f.id}>
                <Link href={`/friends/${f.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/50">
                  <PersonAvatar name={f.name} avatarUrl={f.avatarUrl} className="size-9" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{f.name}</span>
                  <BalanceList balances={balances[f.id] ?? {}} positive="owes you" negative="you owe" className="text-right text-xs" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
