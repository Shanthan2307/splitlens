import { Banknote, ChevronLeft, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Comments } from "@/components/comments/comments";
import { Money } from "@/components/money";
import { PersonAvatar } from "@/components/people/person-avatar";
import { toSettlePerson } from "@/components/settlements/settle-context";
import { fromServerMethod } from "@/components/settlements/methods";
import { SettleUpDialog } from "@/components/settlements/settle-up-dialog";
import { SoftDeleteButton } from "@/components/soft-delete-button";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { requireUser } from "@/lib/auth";
import { listComments } from "@/lib/db/comments";
import { getPeopleByIds, listFriendships } from "@/lib/db/friends";
import { getGroup } from "@/lib/db/groups";
import type { Person } from "@/lib/db/people";
import { getSettlement } from "@/lib/db/settlements";
import { toMajorString } from "@/lib/splits";

export const metadata: Metadata = { title: "Payment · SplitLens" };

const METHOD_LABEL = { cash: "Cash", bank_transfer: "Bank transfer", external_app: "Payment app", other: "Other" } as const;
const PROVIDER_LABEL = { venmo: "Venmo", paypal: "PayPal", other: "Other app" } as const;
const ACTION_LABEL: Record<string, string> = {
  settlement_created: "recorded this payment",
  settlement_updated: "edited this payment",
  settlement_deleted: "deleted this payment",
  settlement_restored: "restored this payment",
};
const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" });
const timeFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

export default async function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, supabase } = await requireUser();
  const settlement = await getSettlement(supabase, id).catch(() => null);
  if (!settlement) notFound();

  const group = settlement.groupId ? await getGroup(supabase, settlement.groupId) : null;
  let people: Record<string, Person>;
  let editable: Person[];
  let meId = user.id;
  if (group) {
    people = Object.fromEntries(group.allMembers.map((m) => [m.memberId, m]));
    editable = group.members;
    meId = group.members.find((m) => m.userId === user.id)?.memberId ?? user.id;
  } else {
    const [byId, friendships] = await Promise.all([
      getPeopleByIds(supabase, [settlement.from, settlement.to, user.id]),
      listFriendships(supabase, user.id),
    ]);
    people = byId;
    editable = [byId[user.id], ...friendships.friends].filter(Boolean);
  }

  const comments = await listComments(supabase, { settlementId: id });
  const memberUserIds = group ? group.allMembers.map((m) => m.userId) : [settlement.from, settlement.to];
  const userIds = [...settlement.history.map((h) => h.actorId), ...comments.map((c) => c.authorId), ...memberUserIds, user.id].filter(
    (u): u is string => Boolean(u),
  );
  const users = await getPeopleByIds(supabase, userIds);
  const authors = Object.fromEntries(Object.values(users).map((p) => [p.id, { name: p.name, avatarUrl: p.avatarUrl }]));
  const name = (participantId: string) => (participantId === meId ? "You" : (people[participantId]?.name ?? "Former member"));
  const canEdit = !settlement.isDeleted && editable.some((p) => p.id === meId);

  return (
    <div className="space-y-6">
      <Link href={group ? `/groups/${group.id}` : "/friends"} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" aria-hidden />
        {group?.name ?? "Friends"}
      </Link>

      {settlement.isDeleted && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm" role="status">
          This payment was deleted and no longer counts toward balances.
        </div>
      )}

      <header className="flex items-start gap-4">
        <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
          <Banknote className="size-7" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {name(settlement.from)} paid {settlement.to === meId ? "you" : name(settlement.to)}
          </h1>
          <Money amount={settlement.amount} currency={settlement.currency} className="mt-1 block text-3xl font-semibold" />
          <p className="mt-1 text-sm text-muted-foreground">
            {dateFormat.format(new Date(`${settlement.date}T00:00:00Z`))} ·{" "}
            {settlement.provider ? PROVIDER_LABEL[settlement.provider] : METHOD_LABEL[settlement.method]}
          </p>
        </div>
      </header>

      <div className="flex items-center justify-center gap-6 rounded-lg border p-4">
        {[settlement.from, settlement.to].map((p, i) => (
          <div key={p} className="flex flex-col items-center gap-1 text-sm">
            <PersonAvatar name={name(p)} avatarUrl={people[p]?.avatarUrl} className="size-10" />
            <span>{name(p)}</span>
            <span className="text-xs text-muted-foreground">{i === 0 ? "paid" : "received"}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <SettleUpDialog
            settlementId={settlement.id}
            groupId={settlement.groupId ?? undefined}
            people={editable.map(toSettlePerson)}
            meId={meId}
            context={group?.name}
            initial={{
              from: settlement.from,
              to: settlement.to,
              amount: toMajorString(settlement.amount, settlement.currency),
              currency: settlement.currency,
              date: settlement.date,
              method: fromServerMethod(settlement.method, settlement.provider),
              notes: settlement.notes ?? "",
            }}
            trigger={
              <Button variant="outline">
                <Pencil aria-hidden />
                Edit
              </Button>
            }
          />
        )}
        {(canEdit || settlement.isDeleted) && (
          <SoftDeleteButton kind="settlement" id={settlement.id} groupId={settlement.groupId} deleted={settlement.isDeleted} />
        )}
      </div>

      {settlement.notes && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Notes</h2>
          <p className="text-sm whitespace-pre-wrap">{settlement.notes}</p>
        </section>
      )}

      <Separator />
      <section>
        <h2 className="mb-3 text-sm font-semibold">Comments</h2>
        <Comments target={{ settlementId: settlement.id }} initial={comments} authors={authors} meUserId={user.id} />
      </section>

      <Separator />
      <section>
        <h2 className="mb-3 text-sm font-semibold">History</h2>
        <ol className="space-y-3 border-l pl-4 text-sm">
          {settlement.history.map((h) => (
            <li key={h.id}>
              <p>
                <span className="font-medium">{h.actorId === user.id ? "You" : (h.actorId && users[h.actorId]?.name) || "Someone"}</span>{" "}
                {ACTION_LABEL[h.action]}
              </p>
              <p className="text-xs text-muted-foreground">{timeFormat.format(new Date(h.createdAt))}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
