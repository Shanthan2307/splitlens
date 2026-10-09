import { ChevronLeft, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Comments } from "@/components/comments/comments";
import { Attachments } from "@/components/expenses/attachments";
import { CategoryIcon } from "@/components/expenses/category-icon";
import { SoftDeleteButton } from "@/components/soft-delete-button";
import { editExpenseContext } from "@/components/expenses/expense-context";
import { ExpenseDialog } from "@/components/expenses/expense-dialog";
import { ExpenseHistory } from "@/components/expenses/expense-history";
import { ReceiptImageCard } from "@/components/expenses/receipt-image";
import { Money } from "@/components/money";
import { PersonAvatar } from "@/components/people/person-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { requireUser } from "@/lib/auth";
import { categoryById } from "@/lib/categories";
import { listComments } from "@/lib/db/comments";
import { getExpense } from "@/lib/db/expenses";
import { getPeopleByIds, listFriendships } from "@/lib/db/friends";
import { getGroup } from "@/lib/db/groups";
import { getReceiptImage } from "@/lib/db/receipts";
import type { Person } from "@/lib/db/people";

export const metadata: Metadata = { title: "Expense · SplitLens" };

const SPLIT_LABEL = {
  equal: "Split equally",
  exact: "Split by exact amounts",
  percentage: "Split by percentage",
  shares: "Split by shares",
  adjustment: "Split equally with adjustments",
  itemized: "Split by items",
} as const;

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" });

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, supabase } = await requireUser();
  const expense = await getExpense(supabase, id).catch(() => null);
  if (!expense) notFound();

  const group = expense.groupId ? await getGroup(supabase, expense.groupId) : null;
  const participantIds = [...expense.payers, ...expense.shares].map((p) => p.participantId);
  const actorIds = expense.history.map((h) => h.actorId).filter((a): a is string => Boolean(a));

  // People on this expense keyed by participant id (member id in groups, user id otherwise).
  let people: Record<string, Person>;
  let editable: Person[] = [];
  let meId = user.id;
  if (group) {
    people = Object.fromEntries(group.allMembers.map((m) => [m.memberId, m]));
    editable = group.members;
    meId = group.members.find((m) => m.userId === user.id)?.memberId ?? user.id;
  } else {
    const [byId, friendships] = await Promise.all([getPeopleByIds(supabase, [...participantIds, user.id]), listFriendships(supabase, user.id)]);
    people = byId;
    editable = [byId[user.id], ...friendships.friends].filter(Boolean);
  }
  const [comments, receipt] = await Promise.all([
    listComments(supabase, { expenseId: expense.id }),
    expense.receiptId ? getReceiptImage(supabase, expense.receiptId).catch(() => null) : null,
  ]);
  const commentAuthorIds = comments.map((c) => c.authorId).filter((a): a is string => Boolean(a));
  // Anyone who can see this expense may comment live, so preload every likely author.
  const memberUserIds = group ? group.allMembers.flatMap((m) => (m.userId ? [m.userId] : [])) : participantIds;
  const actorPeople = await getPeopleByIds(supabase, [...actorIds, ...commentAuthorIds, ...memberUserIds, user.id]);
  const authors = Object.fromEntries(Object.values(actorPeople).map((p) => [p.id, { name: p.name, avatarUrl: p.avatarUrl }]));
  const userNames: Record<string, string> = Object.fromEntries(Object.values(actorPeople).map((p) => [p.id, p.name]));
  userNames[user.id] = "You";

  const nameOf = (participantId: string) =>
    participantId === meId ? "You" : (people[participantId]?.name ?? "Former member");
  const canEdit = !expense.isDeleted && (!group || group.members.some((m) => m.userId === user.id));
  const context = canEdit ? editExpenseContext(expense, editable, meId) : null;
  const creator = expense.createdBy ? (userNames[expense.createdBy] ?? "Someone") : "Someone";

  return (
    <div className="space-y-6">
      <Link
        href={group ? `/groups/${group.id}` : "/friends"}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {group?.name ?? "Friends"}
      </Link>

      {expense.isDeleted && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm" role="status">
          This expense was deleted and no longer counts toward balances.
        </div>
      )}

      <header className="flex items-start gap-4">
        <CategoryIcon category={expense.category} className="size-14" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{expense.description}</h1>
          <Money amount={expense.total} currency={expense.currency} className="mt-1 block text-3xl font-semibold" />
          <p className="mt-1 text-sm text-muted-foreground">
            {dateFormat.format(new Date(`${expense.date}T00:00:00Z`))} · {categoryById(expense.category).label}
            {expense.total < 0 && (
              <Badge variant="secondary" className="ml-2">
                refund
              </Badge>
            )}
          </p>
          <p className="text-xs text-muted-foreground">Added by {creator}</p>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {context && (
          <ExpenseDialog
            {...context}
            trigger={
              <Button variant="outline">
                <Pencil aria-hidden />
                Edit
              </Button>
            }
          />
        )}
        {(canEdit || expense.isDeleted) && (
          <SoftDeleteButton kind="expense" id={expense.id} groupId={expense.groupId} deleted={expense.isDeleted} />
        )}
      </div>

      <section className="grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold">Paid by</h2>
          <ul className="divide-y rounded-lg border">
            {expense.payers.map((p) => (
              <li key={p.participantId} className="flex items-center gap-3 px-3 py-2">
                <PersonAvatar name={nameOf(p.participantId)} avatarUrl={people[p.participantId]?.avatarUrl} className="size-8" />
                <span className="min-w-0 flex-1 truncate text-sm">{nameOf(p.participantId)}</span>
                <Money amount={p.amount} currency={expense.currency} className="text-sm font-medium" />
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold">{SPLIT_LABEL[expense.splitType]}</h2>
          <ul className="divide-y rounded-lg border">
            {expense.shares.map((s) => (
              <li key={s.participantId} className="flex items-center gap-3 px-3 py-2">
                <PersonAvatar name={nameOf(s.participantId)} avatarUrl={people[s.participantId]?.avatarUrl} className="size-8" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {nameOf(s.participantId)} {s.participantId === meId ? "owe" : "owes"}
                </span>
                <Money amount={s.amount} currency={expense.currency} className="text-sm font-medium" />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {receipt && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Receipt</h2>
          <ReceiptImageCard receipt={receipt} />
        </section>
      )}

      {expense.items.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Items</h2>
          <ul className="divide-y rounded-lg border text-sm">
            {expense.items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate">
                    {item.name}
                    {item.originalName && item.originalName !== item.name && (
                      <span className="ml-2 text-xs text-muted-foreground">{item.originalName}</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.assignments.length === 0
                      ? "Everyone, by what they ordered"
                      : item.assignments.map((a) => nameOf(a.participantId) + (a.weight > 1 ? ` ×${a.weight}` : "")).join(", ")}
                  </p>
                </div>
                <Money amount={item.amount} currency={expense.currency} className="tabular-nums" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {expense.notes && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Notes</h2>
          <p className="text-sm whitespace-pre-wrap">{expense.notes}</p>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">Attachments</h2>
        <Attachments expenseId={expense.id} attachments={expense.attachments} myUserId={user.id} canEdit={canEdit} />
      </section>

      <Separator />

      <section>
        <h2 className="mb-3 text-sm font-semibold">Comments</h2>
        <Comments target={{ expenseId: expense.id }} initial={comments} authors={authors} meUserId={user.id} />
      </section>

      <Separator />

      <section>
        <h2 className="mb-3 text-sm font-semibold">History</h2>
        <ExpenseHistory history={expense.history} names={userNames} />
      </section>
    </div>
  );
}
