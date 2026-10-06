import { categoryById } from "@/lib/categories";
import type { ExpenseSnapshot, HistoryEntry } from "@/lib/db/expenses";
import { formatMinor } from "@/lib/splits";

const ACTION_LABEL: Partial<Record<HistoryEntry["action"], string>> = {
  expense_created: "added this expense",
  expense_updated: "edited this expense",
  expense_deleted: "deleted this expense",
  expense_restored: "restored this expense",
};

const SPLIT_LABEL: Record<string, string> = {
  equal: "equally",
  exact: "by exact amounts",
  percentage: "by percentage",
  shares: "by shares",
  adjustment: "with adjustments",
  itemized: "by items",
};

const timeFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

function people(list: ExpenseSnapshot["payers"], currency: string) {
  return list.map((p) => `${p.name ?? "Someone"} ${formatMinor(p.amount, currency)}`).join(", ");
}

/** Human-readable list of what changed between two snapshots. */
function changes(before: ExpenseSnapshot, after: ExpenseSnapshot): string[] {
  const out: string[] = [];
  if (before.description !== after.description) out.push(`Description: “${before.description}” → “${after.description}”`);
  if (before.total_minor !== after.total_minor || before.currency !== after.currency) {
    out.push(`Amount: ${formatMinor(before.total_minor, before.currency)} → ${formatMinor(after.total_minor, after.currency)}`);
  }
  if (before.expense_date !== after.expense_date) out.push(`Date: ${before.expense_date} → ${after.expense_date}`);
  if (before.category !== after.category) {
    out.push(`Category: ${categoryById(before.category).label} → ${categoryById(after.category).label}`);
  }
  if ((before.notes ?? "") !== (after.notes ?? "")) out.push("Notes changed");
  if (people(before.payers, before.currency) !== people(after.payers, after.currency)) {
    out.push(`Paid by: ${people(after.payers, after.currency)}`);
  }
  if (before.split_type !== after.split_type || people(before.shares, before.currency) !== people(after.shares, after.currency)) {
    out.push(`Split ${SPLIT_LABEL[after.split_type] ?? ""}: ${people(after.shares, after.currency)}`);
  }
  return out;
}

export function ExpenseHistory({ history, names }: { history: HistoryEntry[]; names: Record<string, string> }) {
  if (history.length === 0) return <p className="text-sm text-muted-foreground">No history.</p>;
  return (
    <ol className="space-y-4 border-l pl-4">
      {history.map((h) => {
        const diff = h.action === "expense_updated" && h.before && h.after ? changes(h.before, h.after) : [];
        return (
          <li key={h.id} className="relative text-sm">
            <span className="absolute top-1.5 -left-[21px] size-2 rounded-full bg-muted-foreground" aria-hidden />
            <p>
              <span className="font-medium">{(h.actorId && names[h.actorId]) || "Someone"}</span> {ACTION_LABEL[h.action] ?? h.action}
            </p>
            <p className="text-xs text-muted-foreground">{timeFormat.format(new Date(h.createdAt))}</p>
            {diff.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                {diff.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
