import type { ExpenseFormInitial, FormPerson } from "@/components/expenses/expense-form";
import { categoryById, type CategoryId } from "@/lib/categories";
import type { ExpenseDetail } from "@/lib/db/expenses";
import { toStoredExpense } from "@/lib/db/expenses";
import type { GroupDetail } from "@/lib/db/groups";
import type { Person } from "@/lib/db/people";
import { defaultSplitDraft, draftFromExpense } from "@/lib/splits";

/** Props for ExpenseDialog, built on the server from loaded data (no money math). */
export type ExpenseContext = {
  groupId?: string;
  people: FormPerson[];
  meId: string;
  friendMode: boolean;
  initial: ExpenseFormInitial;
  /** Set by the page when "Also post to Splitwise" can apply (see postTargets). */
  splitwise?: { participants: Record<string, number> };
};

const toFormPerson = (p: Person): FormPerson => ({ id: p.id, name: p.name, avatarUrl: p.avatarUrl });

function blank(currency: string, meId: string): Omit<ExpenseFormInitial, "split"> {
  return { description: "", category: "general", date: null, notes: "", currency, total: "", paidBy: { mode: "single", participantId: meId } };
}

export function groupExpenseContext(group: GroupDetail, myUserId: string): ExpenseContext | null {
  const me = group.members.find((m) => m.userId === myUserId);
  if (!me) return null;
  const people = [me, ...group.members.filter((m) => m.memberId !== me.memberId)];
  return {
    groupId: group.id,
    people: people.map(toFormPerson),
    meId: me.memberId,
    friendMode: false,
    initial: {
      ...blank(group.defaultCurrency, me.memberId),
      split: defaultSplitDraft(
        group.defaultSplitType,
        people.map((m) => ({ participantId: m.memberId, weight: m.defaultSplitWeight })),
      ),
    },
  };
}

export function friendExpenseContext(
  me: Person,
  friends: Person[],
  preselected: string[],
  defaultCurrency: string,
): ExpenseContext {
  const involved = [me.id, ...preselected];
  return {
    people: [me, ...friends].map(toFormPerson),
    meId: me.id,
    friendMode: true,
    initial: {
      ...blank(defaultCurrency, me.id),
      involvedIds: involved,
      split: { type: "equal", participants: involved },
    },
  };
}

/** Edit context: participants come from the expense; group expenses use member ids. */
export function editExpenseContext(
  expense: ExpenseDetail,
  people: Person[],
  meId: string,
): ExpenseContext & { expenseId: string } {
  const draft = draftFromExpense(toStoredExpense(expense));
  const participantIds = new Set([...expense.payers, ...expense.shares].map((p) => p.participantId));
  return {
    expenseId: expense.id,
    groupId: expense.groupId ?? undefined,
    people: [people.find((p) => p.id === meId), ...people.filter((p) => p.id !== meId)]
      .filter((p): p is Person => Boolean(p))
      .map(toFormPerson),
    meId,
    friendMode: expense.groupId === null,
    initial: {
      description: expense.description,
      category: categoryById(expense.category).id as CategoryId,
      date: expense.date,
      notes: expense.notes ?? "",
      currency: draft.currency,
      total: draft.total,
      paidBy: draft.paidBy,
      split: draft.split,
      involvedIds: expense.groupId === null ? [...participantIds] : undefined,
      receiptId: expense.receiptId ?? undefined,
    },
  };
}
