import type { Metadata } from "next";
import Link from "next/link";
import { CreateGroupDialog } from "@/components/groups/create-group-dialog";
import { GroupAvatar } from "@/components/groups/group-type";
import { BalanceList } from "@/components/money";
import { EmptyState, PageHeader } from "@/components/shell/page-header";
import { requireUser } from "@/lib/auth";
import { listMyGroups } from "@/lib/db/groups";
import { loadUserLedger } from "@/lib/db/ledger";
import { getProfile } from "@/lib/db/profiles";
import { netBalances, participantBalance } from "@/lib/splits";

export const metadata: Metadata = { title: "Groups · SplitLens" };

export default async function GroupsPage() {
  const { user, supabase } = await requireUser();
  const [groups, ledger, profile] = await Promise.all([
    listMyGroups(supabase, user.id),
    loadUserLedger(supabase, user.id),
    getProfile(supabase, user.id),
  ]);

  // My net per currency in each group.
  const myBalance = new Map(
    ledger.groups.map((g) => {
      const myMemberId = Object.keys(g.memberUsers).find((m) => g.memberUsers[m] === user.id);
      return [g.groupId, myMemberId ? participantBalance(netBalances(g.entries), myMemberId) : {}];
    }),
  );

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4">
        <PageHeader title="Groups" description="Trips, homes, couples and more." />
        <CreateGroupDialog defaultCurrency={profile.default_currency} />
      </div>
      {groups.length === 0 ? (
        <EmptyState title="No groups yet">Create a group to start splitting with several people.</EmptyState>
      ) : (
        <ul className="divide-y rounded-lg border">
          {groups.map((g) => (
            <li key={g.id}>
              <Link href={`/groups/${g.id}`} className="flex items-center gap-3 p-3 hover:bg-accent/50">
                <GroupAvatar type={g.type} coverUrl={g.coverUrl} />
                <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                <BalanceList
                  balances={myBalance.get(g.id) ?? {}}
                  positive="you are owed"
                  negative="you owe"
                  className="text-right text-xs"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
