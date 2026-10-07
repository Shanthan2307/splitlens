import "server-only";
import type { DbClient } from "@/lib/db/client";
import { setSplitwiseExpenseId, splitwiseParticipants } from "@/lib/db/splitwise";
import { toMajorString, toSplitwiseUsers, type BuiltExpense } from "@/lib/splits";
import { splitwiseFor } from "./session";

export class SplitwisePostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplitwisePostError";
  }
}

/**
 * Creates the same expense on Splitwise (exact paid/owed shares, so any split type works)
 * and stores its Splitwise id, so a later import recognises it instead of duplicating it.
 */
export async function postExpenseToSplitwise(
  db: DbClient,
  userId: string,
  expense: {
    expenseId: string;
    groupId?: string;
    description: string;
    date: string;
    notes?: string;
    currency: string;
    built: BuiltExpense;
  },
): Promise<number> {
  if (expense.built.total < 0) throw new SplitwisePostError("Splitwise doesn't support refunds.");
  const targets = await splitwiseParticipants(db, expense.groupId ? { groupId: expense.groupId } : {
    userIds: [...new Set([...expense.built.payers, ...expense.built.shares].map((p) => p.participantId))],
  });
  if (targets.splitwiseGroupId === null) throw new SplitwisePostError("This group isn't linked to a Splitwise group.");

  const toSw = (list: readonly { participantId: string; amount: number }[]) =>
    list
      .filter((p) => p.amount !== 0)
      .map((p) => {
        const userId = targets.participants[p.participantId];
        if (userId === undefined) throw new SplitwisePostError("Everyone on the expense needs to be on Splitwise.");
        return { userId, amount: p.amount };
      });

  const users = toSplitwiseUsers(expense.currency, toSw(expense.built.payers), toSw(expense.built.shares));
  const { api, admin } = await splitwiseFor(userId);
  const splitwiseId = await api.createExpense({
    cost: toMajorString(expense.built.total, expense.currency),
    description: expense.description,
    currencyCode: expense.currency,
    groupId: targets.splitwiseGroupId,
    date: expense.date,
    details: expense.notes,
    users,
  });
  await setSplitwiseExpenseId(admin, userId, expense.expenseId, splitwiseId);
  return splitwiseId;
}
