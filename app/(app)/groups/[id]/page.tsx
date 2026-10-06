import { HandCoins, Plus, Settings } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExpenseDialog } from "@/components/expenses/expense-dialog";
import { groupExpenseContext } from "@/components/expenses/expense-context";
import { ExpenseList } from "@/components/expenses/expense-list";
import { GROUP_TYPE_META, GroupAvatar } from "@/components/groups/group-type";
import { BalanceList, Money } from "@/components/money";
import { PersonAvatar } from "@/components/people/person-avatar";
import { initialFromDebt, toSettlePerson } from "@/components/settlements/settle-context";
import { SettleUpDialog } from "@/components/settlements/settle-up-dialog";
import { EmptyState } from "@/components/shell/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireUser } from "@/lib/auth";
import { getGroup } from "@/lib/db/groups";
import { loadGroupLedger } from "@/lib/db/ledger";
import { groupDebts, netBalances, participantBalance } from "@/lib/splits";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { supabase } = await requireUser();
  const group = await getGroup(supabase, id).catch(() => null);
  return { title: `${group?.name ?? "Group"} · SplitLens` };
}

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  const { user, supabase } = await requireUser();
  const group = await getGroup(supabase, id);
  if (!group) notFound();

  const { expenses, settlements, entries } = await loadGroupLedger(supabase, id);
  const balances = netBalances(entries);
  const debts = groupDebts(entries, { simplify: group.simplifyDebts });
  const alternative = groupDebts(entries, { simplify: !group.simplifyDebts });

  const me = group.members.find((m) => m.userId === user.id);
  const names = Object.fromEntries(group.allMembers.map((m) => [m.memberId, m.userId === user.id ? "You" : m.name]));
  const context = groupExpenseContext(group, user.id);
  const settlePeople = group.members.map(toSettlePerson);
  const TypeIcon = GROUP_TYPE_META[group.type].icon;

  // "Settle up" from the header suggests my own most relevant payment first.
  const myDebt = me && (debts.find((d) => d.from === me.memberId) ?? debts.find((d) => d.to === me.memberId));
  const other = group.members.find((m) => m.memberId !== me?.memberId);

  return (
    <>
      <header className="mb-6 flex items-start gap-4">
        <GroupAvatar type={group.type} coverUrl={group.coverUrl} className="size-16" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{group.name}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <TypeIcon className="size-4" aria-hidden />
            {GROUP_TYPE_META[group.type].label} · {group.members.length} {group.members.length === 1 ? "person" : "people"}
          </p>
          {me && (
            <BalanceList
              balances={participantBalance(balances, me.memberId)}
              positive="You are owed"
              negative="You owe"
              zero="You're all settled up"
              className="mt-2 text-sm"
            />
          )}
        </div>
        <Button variant="outline" size="icon" asChild>
          <Link href={`/groups/${id}/settings`} aria-label="Group settings">
            <Settings />
          </Link>
        </Button>
      </header>

      <div className="mb-6 flex flex-wrap gap-2">
        {context && (
          <div className="hidden md:block">
            <ExpenseDialog
              {...context}
              trigger={
                <Button>
                  <Plus aria-hidden />
                  Add expense
                </Button>
              }
            />
          </div>
        )}
        {me && other && (
          <SettleUpDialog
            groupId={id}
            people={settlePeople}
            meId={me.memberId}
            context={group.name}
            initial={initialFromDebt(myDebt, { from: me.memberId, to: other.memberId, currency: group.defaultCurrency })}
            trigger={
              <Button variant="outline">
                <HandCoins aria-hidden />
                Settle up
              </Button>
            }
          />
        )}
      </div>

      <Tabs defaultValue={tab === "balances" ? "balances" : "expenses"}>
        <TabsList className="mb-4">
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="balances">Balances</TabsTrigger>
        </TabsList>
        <TabsContent value="expenses">
          <ExpenseList
            expenses={expenses}
            settlements={settlements}
            names={names}
            myIds={me ? [me.memberId, user.id] : [user.id]}
            empty={<EmptyState title="No expenses yet">Add the first expense for this group.</EmptyState>}
          />
        </TabsContent>
        <TabsContent value="balances" className="space-y-6">
          <ul className="divide-y rounded-lg border">
            {group.members.map((m) => (
              <li key={m.memberId} className="flex items-center gap-3 px-3 py-2">
                <PersonAvatar name={m.name} avatarUrl={m.avatarUrl} className="size-8" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {m.userId === user.id ? "You" : m.name}
                  {m.isPlaceholder && (
                    <Badge variant="secondary" className="ml-2">
                      invited
                    </Badge>
                  )}
                </span>
                <BalanceList balances={participantBalance(balances, m.memberId)} positive="gets back" negative="owes" className="text-right text-sm" />
              </li>
            ))}
          </ul>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{group.simplifyDebts ? "Suggested payments" : "Who owes whom"}</h2>
            {debts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Everyone is settled up.</p>
            ) : (
              <ul className="divide-y rounded-lg border text-sm">
                {debts.map((d) => (
                  <li key={`${d.from}-${d.to}-${d.currency}`} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{names[d.from] ?? "Someone"}</span> {d.from === me?.memberId ? "owe" : "owes"}{" "}
                      <span className="font-medium">{names[d.to] ?? "someone"}</span>
                    </span>
                    <Money amount={d.amount} currency={d.currency} className="font-medium" />
                    {me && (
                      <SettleUpDialog
                        groupId={id}
                        people={settlePeople}
                        meId={me.memberId}
                        context={group.name}
                        initial={initialFromDebt(d, { from: d.from, to: d.to, currency: d.currency })}
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
            )}
            {group.simplifyDebts && debts.length < alternative.length && (
              <p className="text-xs text-muted-foreground">
                Simplify debts is on: {debts.length} {debts.length === 1 ? "payment" : "payments"} instead of {alternative.length}.
              </p>
            )}
            {!group.simplifyDebts && alternative.length < debts.length && (
              <p className="text-xs text-muted-foreground">
                Turn on{" "}
                <Link href={`/groups/${id}/settings`} className="underline">
                  simplify debts
                </Link>{" "}
                to settle up with {alternative.length} {alternative.length === 1 ? "payment" : "payments"} instead of {debts.length}.
              </p>
            )}
          </section>
        </TabsContent>
      </Tabs>

      {context && (
        <div className="fixed right-4 bottom-20 z-30 md:hidden">
          <ExpenseDialog
            {...context}
            trigger={
              <Button size="lg" className="rounded-full shadow-lg" aria-label="Add expense">
                <Plus aria-hidden />
                Add expense
              </Button>
            }
          />
        </div>
      )}
    </>
  );
}
