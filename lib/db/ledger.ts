import type { KeyedGroupLedger, LedgerEntry } from "@/lib/splits";
import { dbError, type DbClient } from "./client";
import { listGroupExpenses, listVisibleExpenses, toLedgerEntry, type ExpenseSummary } from "./expenses";
import { listGroupSettlements, listVisibleSettlements, toLedgerSettlement, type SettlementSummary } from "./settlements";

/**
 * Everything needed to compute a user's balances across groups and friends:
 * raw rows from the DB shaped into lib/splits ledger inputs (no money math here).
 */
export type UserLedger = {
  groups: (KeyedGroupLedger & { name: string })[];
  direct: LedgerEntry[];
  expenses: ExpenseSummary[];
  settlements: SettlementSummary[];
  /** member id → user id across all of the user's groups (null for placeholders). */
  memberUsers: Record<string, string | null>;
  /** Display names for member ids and user ids seen in the user's groups. */
  names: Record<string, string>;
};

export async function loadUserLedger(db: DbClient, userId: string): Promise<UserLedger> {
  const [{ data: memberships, error }, expenses, settlements] = await Promise.all([
    db
      .from("group_members")
      .select(
        "group:groups!inner(id, name, simplify_debts, deleted_at, group_members(id, user_id, placeholder_name, profile:profiles(display_name, email)))",
      )
      .eq("user_id", userId)
      .is("left_at", null)
      .is("group.deleted_at", null),
    listVisibleExpenses(db),
    listVisibleSettlements(db),
  ]);
  if (error) throw dbError("Could not load groups", error);

  const memberUsers: Record<string, string | null> = {};
  const names: Record<string, string> = {};
  const groups = new Map<string, UserLedger["groups"][number]>();
  for (const { group } of memberships) {
    const users: Record<string, string | null> = {};
    for (const m of group.group_members) {
      users[m.id] = memberUsers[m.id] = m.user_id;
      const name = m.profile?.display_name || m.placeholder_name || m.profile?.email?.split("@")[0] || "Someone";
      names[m.id] = name;
      if (m.user_id) names[m.user_id] = name;
    }
    groups.set(group.id, { groupId: group.id, name: group.name, simplify: group.simplify_debts, entries: [], memberUsers: users });
  }

  const direct: LedgerEntry[] = [];
  const push = (groupId: string | null, entry: LedgerEntry) => {
    if (groupId === null) direct.push(entry);
    else groups.get(groupId)?.entries.push(entry);
  };
  for (const e of expenses) push(e.groupId, toLedgerEntry(e));
  for (const s of settlements) push(s.groupId, toLedgerSettlement(s));

  return { groups: [...groups.values()], direct, expenses, settlements, memberUsers, names };
}

/** A group's expenses, settlements and the combined ledger entries (member-id participants). */
export async function loadGroupLedger(db: DbClient, groupId: string) {
  const [expenses, settlements] = await Promise.all([listGroupExpenses(db, groupId), listGroupSettlements(db, groupId)]);
  const entries: LedgerEntry[] = [...expenses.map(toLedgerEntry), ...settlements.map(toLedgerSettlement)];
  return { expenses, settlements, entries };
}
