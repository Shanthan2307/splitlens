import { Banknote, ReceiptText } from "lucide-react";
import Link from "next/link";
import { CategoryIcon } from "@/components/expenses/category-icon";
import { Money } from "@/components/money";
import type { ExpenseSummary } from "@/lib/db/expenses";
import type { SettlementSummary } from "@/lib/db/settlements";
import { formatMinor, participantNet } from "@/lib/splits";

type Props = {
  expenses: ExpenseSummary[];
  settlements?: SettlementSummary[];
  /** Participant id (member or user id) → display name. */
  names: Record<string, string>;
  /** All of my participant ids: my user id plus my member ids. */
  myIds: string[];
  /** Shown under the description when listing across groups. */
  groupNames?: Record<string, string>;
  empty?: React.ReactNode;
};

type Row = { kind: "expense"; date: string; createdAt: string; item: ExpenseSummary } | { kind: "settlement"; date: string; createdAt: string; item: SettlementSummary };

const monthFormat = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

/** Expenses and payments, newest first, grouped by month. */
export function ExpenseList({ expenses, settlements = [], names, myIds, groupNames, empty }: Props) {
  const rows: Row[] = [
    ...expenses.map((e) => ({ kind: "expense" as const, date: e.date, createdAt: e.createdAt, item: e })),
    ...settlements.map((s) => ({ kind: "settlement" as const, date: s.date, createdAt: s.createdAt, item: s })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  if (rows.length === 0) return <>{empty}</>;
  const mine = new Set(myIds);
  const months = Object.entries(Object.groupBy(rows, (r) => r.date.slice(0, 7)));

  return (
    <div className="space-y-6">
      {months.map(([month, items]) => (
        <section key={month}>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {monthFormat.format(new Date(`${month}-01T00:00:00Z`))}
          </h3>
          <ul className="divide-y rounded-lg border">
            {items!.map((r) =>
              r.kind === "expense" ? (
                <ExpenseRow
                  key={r.item.id}
                  expense={r.item}
                  names={names}
                  mine={mine}
                  groupName={r.item.groupId ? groupNames?.[r.item.groupId] : undefined}
                />
              ) : (
                <SettlementRow
                  key={r.item.id}
                  settlement={r.item}
                  names={names}
                  mine={mine}
                  groupName={r.item.groupId ? groupNames?.[r.item.groupId] : undefined}
                />
              ),
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DateCell({ date }: { date: string }) {
  return (
    <span className="w-10 shrink-0 text-center text-xs leading-tight text-muted-foreground">
      {dayFormat.format(new Date(`${date}T00:00:00Z`))}
    </span>
  );
}

function ExpenseRow({
  expense: e,
  names,
  mine,
  groupName,
}: {
  expense: ExpenseSummary;
  names: Record<string, string>;
  mine: Set<string>;
  groupName?: string;
}) {
  const myId = [...e.payers, ...e.shares].find((p) => mine.has(p.participantId))?.participantId;
  const net = myId ? participantNet(e.payers, e.shares, myId) : 0;
  const payer =
    e.payers.length > 1
      ? `${e.payers.length} people`
      : mine.has(e.payers[0]?.participantId ?? "")
        ? "You"
        : (names[e.payers[0]?.participantId ?? ""] ?? "Someone");

  return (
    <li>
      <Link href={`/expenses/${e.id}`} className="flex items-center gap-3 px-3 py-3 hover:bg-accent/50">
        <DateCell date={e.date} />
        <CategoryIcon category={e.category} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="truncate">{e.description}</span>
            {e.receiptId && (
              <ReceiptText className="size-3.5 shrink-0 text-muted-foreground" aria-label="Has a scanned receipt" role="img" />
            )}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {payer} paid {formatMinor(e.total, e.currency)}
            {groupName && ` · ${groupName}`}
          </span>
        </span>
        <span className="shrink-0 text-right text-xs">
          {!myId || net === 0 ? (
            <span className="text-muted-foreground">{myId ? "no balance" : "not involved"}</span>
          ) : (
            <>
              <span className="block text-muted-foreground">{net > 0 ? "you lent" : "you borrowed"}</span>
              <Money amount={net} currency={e.currency} tone absolute className="text-sm font-medium" />
            </>
          )}
        </span>
      </Link>
    </li>
  );
}

function SettlementRow({
  settlement: s,
  names,
  mine,
  groupName,
}: {
  settlement: SettlementSummary;
  names: Record<string, string>;
  mine: Set<string>;
  groupName?: string;
}) {
  const name = (id: string) => (mine.has(id) ? "You" : (names[id] ?? "Someone"));
  const role = mine.has(s.from) ? "you paid" : mine.has(s.to) ? "you received" : null;
  return (
    <li>
      <Link href={`/settlements/${s.id}`} className="flex items-center gap-3 px-3 py-3 hover:bg-accent/50">
        <DateCell date={s.date} />
        <span
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          aria-hidden
        >
          <Banknote className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {name(s.from)} paid {mine.has(s.to) ? "you" : name(s.to)}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            Payment{groupName && ` · ${groupName}`}
          </span>
        </span>
        <span className="shrink-0 text-right text-xs">
          {role && <span className="block text-muted-foreground">{role}</span>}
          <Money amount={s.amount} currency={s.currency} className="text-sm font-medium" />
        </span>
      </Link>
    </li>
  );
}
