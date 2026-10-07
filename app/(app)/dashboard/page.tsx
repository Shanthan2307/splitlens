import { ArrowRightLeft, Plus, UserPlus, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ExpenseDialog } from "@/components/expenses/expense-dialog";
import { friendExpenseContext } from "@/components/expenses/expense-context";
import { BalanceList, Money } from "@/components/money";
import { PersonAvatar } from "@/components/people/person-avatar";
import { EmptyState, PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { listFriendships } from "@/lib/db/friends";
import { loadUserLedger } from "@/lib/db/ledger";
import { getMe } from "@/lib/db/me";
import { splitwiseConfig } from "@/lib/env.server";
import { balanceSummary, friendBalances, netBalances, participantBalance, userDebts } from "@/lib/splits";
import { cn } from "@/lib/utils";
import { postTargets } from "@/lib/db/splitwise";

export const metadata: Metadata = { title: "Dashboard · SplitLens" };

function Totals({ amounts, tone, empty }: { amounts: Record<string, number>; tone?: "owe" | "owed"; empty: string }) {
  const entries = Object.entries(amounts);
  if (entries.length === 0) return <p className="text-2xl font-semibold text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-0.5">
      {entries.map(([currency, amount]) => (
        <li key={currency}>
          <Money
            amount={tone === "owe" ? -amount : amount}
            currency={currency}
            tone
            absolute={Boolean(tone)}
            className="text-2xl font-semibold"
          />
        </li>
      ))}
    </ul>
  );
}

export default async function DashboardPage() {
  const { user, supabase } = await requireUser();
  const [me, ledger, friendships] = await Promise.all([
    getMe(supabase, user.id),
    loadUserLedger(supabase, user.id),
    listFriendships(supabase, user.id),
  ]);

  // Counterparties include group placeholders (kept under their member id) so totals are complete.
  const byPerson = friendBalances(user.id, userDebts(ledger.groups, ledger.direct, { keepPlaceholders: true }));
  const summary = balanceSummary(byPerson);
  const friendIds = new Set(friendships.friends.map((f) => f.id));
  const avatar = new Map(friendships.friends.map((f) => [f.id, f.avatarUrl]));
  const placeholderGroup = (memberId: string) => ledger.groups.find((g) => memberId in g.memberUsers)?.groupId;

  const people = Object.entries(byPerson).map(([id, balances]) => ({
    id,
    name: ledger.names[id] ?? friendships.friends.find((f) => f.id === id)?.name ?? "Someone",
    href: friendIds.has(id) ? `/friends/${id}` : placeholderGroup(id) ? `/groups/${placeholderGroup(id)}?tab=balances` : null,
    balances,
  }));
  const owe = people.filter((p) => Object.values(p.balances).some((v) => v < 0));
  const owed = people.filter((p) => Object.values(p.balances).some((v) => v > 0));

  const groups = ledger.groups.map((g) => {
    const myMemberId = Object.keys(g.memberUsers).find((m) => g.memberUsers[m] === user.id);
    return { id: g.groupId, name: g.name, balances: myMemberId ? participantBalance(netBalances(g.entries), myMemberId) : {} };
  });
  const splitwiseReady = splitwiseConfig() !== null;
  const context = {
    ...friendExpenseContext(me, friendships.friends, [], me.defaultCurrency),
    splitwise: await postTargets(supabase, user.id, { userIds: friendships.friends.map((f) => f.id) }),
  };
  const isNew = ledger.groups.length === 0 && friendships.friends.length === 0;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <PageHeader title="Dashboard" description="Your balances across every group and friend." />
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

      {isNew ? (
        <EmptyState title="Welcome to SplitLens">
          {splitwiseReady && (
            <span className="mx-auto mt-4 block max-w-sm rounded-lg border bg-background p-4 text-left">
              <span className="flex items-center gap-2 font-medium text-foreground">
                <ArrowRightLeft className="size-4" aria-hidden /> Coming from Splitwise?
              </span>
              <span className="mt-1 block">Bring your groups, friends, balances and history over in a minute.</span>
              <Button asChild className="mt-3 w-full">
                <Link href="/import/splitwise">Import from Splitwise</Link>
              </Button>
            </span>
          )}
          <span className="mt-4 flex flex-wrap justify-center gap-2">
            <Button asChild variant={splitwiseReady ? "outline" : "default"}>
              <Link href="/groups">
                <Users aria-hidden />
                Create a group
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/friends">
                <UserPlus aria-hidden />
                Add a friend
              </Link>
            </Button>
          </span>
        </EmptyState>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3" aria-label="Totals">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">Total balance</CardTitle>
              </CardHeader>
              <CardContent>
                <Totals amounts={summary.net} empty="Settled up" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">You owe</CardTitle>
              </CardHeader>
              <CardContent>
                <Totals amounts={summary.owe} tone="owe" empty="Nothing" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">You are owed</CardTitle>
              </CardHeader>
              <CardContent>
                <Totals amounts={summary.owed} tone="owed" empty="Nothing" />
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-6 md:grid-cols-2">
            {[
              { title: "You owe", list: owe, sign: -1, empty: "You don't owe anyone." },
              { title: "Owes you", list: owed, sign: 1, empty: "Nobody owes you right now." },
            ].map(({ title, list, sign, empty }) => (
              <div key={title} className="space-y-2">
                <h2 className="text-sm font-semibold">{title}</h2>
                {list.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{empty}</p>
                ) : (
                  <ul className="divide-y rounded-lg border">
                    {list.map((p) => {
                      const row = (
                        <>
                          <PersonAvatar name={p.name} avatarUrl={avatar.get(p.id)} className="size-9" />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                          <span className="flex flex-col items-end text-sm">
                            {Object.entries(p.balances)
                              .filter(([, v]) => Math.sign(v) === sign)
                              .map(([currency, v]) => (
                                <Money key={currency} amount={v} currency={currency} tone absolute className="font-medium" />
                              ))}
                          </span>
                        </>
                      );
                      return (
                        <li key={p.id}>
                          {p.href ? (
                            <Link href={p.href} className={cn("flex items-center gap-3 px-3 py-2 hover:bg-accent/50")}>
                              {row}
                            </Link>
                          ) : (
                            <div className="flex items-center gap-3 px-3 py-2">{row}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Groups</h2>
            {groups.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No groups yet. <Link href="/groups" className="underline">Create one</Link>.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {groups.map((g) => (
                  <li key={g.id}>
                    <Link href={`/groups/${g.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-accent/50">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{g.name}</span>
                      <BalanceList balances={g.balances} positive="you are owed" negative="you owe" className="text-right text-xs" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
