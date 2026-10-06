import { ChevronLeft, HandCoins, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExpenseDialog } from "@/components/expenses/expense-dialog";
import { friendExpenseContext } from "@/components/expenses/expense-context";
import { ExpenseList } from "@/components/expenses/expense-list";
import { BalanceList, Money } from "@/components/money";
import { PersonAvatar } from "@/components/people/person-avatar";
import { toSettlePerson } from "@/components/settlements/settle-context";
import { SettleUpDialog } from "@/components/settlements/settle-up-dialog";
import { EmptyState } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { getProfilePerson, listFriendships } from "@/lib/db/friends";
import { loadUserLedger } from "@/lib/db/ledger";
import { getMe } from "@/lib/db/me";
import { balancesBetween, friendBalances, toMajorString, userDebts } from "@/lib/splits";

export const metadata: Metadata = { title: "Friend · SplitLens" };

export default async function FriendPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, supabase } = await requireUser();
  const [friend, me, friendships, ledger] = await Promise.all([
    getProfilePerson(supabase, id).catch(() => null),
    getMe(supabase, user.id),
    listFriendships(supabase, user.id),
    loadUserLedger(supabase, user.id),
  ]);
  if (!friend || id === user.id) notFound();
  const isFriend = friendships.friends.some((f) => f.id === id);

  const balance = friendBalances(user.id, userDebts(ledger.groups, ledger.direct))[id] ?? {};

  // Expenses involving both of us: friend-only ones by user id, group ones via member → user.
  const userOf = (participantId: string) => ledger.memberUsers[participantId] ?? participantId;
  const shared = ledger.expenses.filter((e) => {
    const users = new Set([...e.payers, ...e.shares].map((p) => userOf(p.participantId)));
    return users.has(user.id) && users.has(id);
  });
  const sharedPayments = ledger.settlements.filter((s) => {
    const users = new Set([userOf(s.from), userOf(s.to)]);
    return users.has(user.id) && users.has(id);
  });

  // Where our balance lives (each group, plus outside groups), so each can be settled in its own context.
  const pairs = balancesBetween(ledger.groups, ledger.direct, user.id, id).map((b) => {
    const group = b.groupId ? ledger.groups.find((g) => g.groupId === b.groupId) : undefined;
    const memberOf = (userId: string) => (group ? Object.keys(group.memberUsers).find((m) => group.memberUsers[m] === userId) : userId);
    const myId = memberOf(user.id)!;
    const theirId = memberOf(id)!;
    return {
      ...b,
      groupName: group?.name ?? "Outside groups",
      meId: myId,
      people: [
        { ...toSettlePerson(me), id: myId },
        { ...toSettlePerson(friend), id: theirId },
      ],
      // Positive amount: they owe me, so they're the payer.
      initial: {
        from: b.amount > 0 ? theirId : myId,
        to: b.amount > 0 ? myId : theirId,
        amount: toMajorString(Math.abs(b.amount), b.currency),
        currency: b.currency,
      },
    };
  });
  const names = { ...ledger.names, [user.id]: "You", [id]: friend.name };
  const myIds = [user.id, ...Object.keys(ledger.memberUsers).filter((m) => ledger.memberUsers[m] === user.id)];
  const groupNames = Object.fromEntries(ledger.groups.map((g) => [g.groupId, g.name]));
  const context = friendExpenseContext(me, friendships.friends, [id], me.defaultCurrency);

  return (
    <div className="space-y-6">
      <Link href="/friends" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden />
        Friends
      </Link>
      <header className="flex items-center gap-4">
        <PersonAvatar name={friend.name} avatarUrl={friend.avatarUrl} className="size-16 text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{friend.name}</h1>
          {friend.email && <p className="truncate text-sm text-muted-foreground">{friend.email}</p>}
          <BalanceList
            balances={balance}
            positive={`${friend.name} owes you`}
            negative={`You owe ${friend.name}`}
            zero="You're all settled up"
            className="mt-2 text-sm"
          />
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {isFriend && (
          <ExpenseDialog
            {...context}
            trigger={
              <Button>
                <Plus aria-hidden />
                Add expense
              </Button>
            }
          />
        )}
        {isFriend && pairs.length === 0 && (
          <SettleUpDialog
            people={[toSettlePerson(me), toSettlePerson(friend)]}
            meId={user.id}
            initial={{ from: user.id, to: id, amount: "", currency: me.defaultCurrency }}
            trigger={
              <Button variant="outline">
                <HandCoins aria-hidden />
                Record a payment
              </Button>
            }
          />
        )}
      </div>

      {pairs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Balance by group</h2>
          <ul className="divide-y rounded-lg border text-sm">
            {pairs.map((b) => (
              <li key={`${b.groupId}-${b.currency}`} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{b.groupName}</span>
                  <span className="text-xs text-muted-foreground">{b.amount > 0 ? `${friend.name} owes you` : `You owe ${friend.name}`}</span>
                </span>
                <Money amount={b.amount} currency={b.currency} tone absolute className="font-medium" />
                {(b.groupId || isFriend) && (
                  <SettleUpDialog
                    groupId={b.groupId ?? undefined}
                    people={b.people}
                    meId={b.meId}
                    context={b.groupId ? b.groupName : undefined}
                    initial={b.initial}
                    trigger={
                      <Button size="sm" variant="outline">
                        Settle
                      </Button>
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ExpenseList
        expenses={shared}
        settlements={sharedPayments}
        names={names}
        myIds={myIds}
        groupNames={groupNames}
        empty={<EmptyState title="Nothing shared yet">Expenses you share with {friend.name} will show up here.</EmptyState>}
      />
    </div>
  );
}
