import { friendBalances, pairwiseDebts, remapDebts, sortDebts, type CurrencyBalances, type LedgerEntry } from "./balances";
import type { Minor } from "./money";
import type { Debt, ParticipantId } from "./types";

export type GroupLedger = {
  simplify: boolean;
  /** Entries whose participant ids are group member ids. */
  entries: LedgerEntry[];
  /** member id → user id (null for placeholders). */
  memberUsers: Readonly<Record<ParticipantId, ParticipantId | null>>;
};

export type KeyedGroupLedger = GroupLedger & { groupId: string };

function userIdMap(g: GroupLedger, keepPlaceholders: boolean) {
  if (!keepPlaceholders) return g.memberUsers;
  // Placeholders keep their member id so debts with them still count toward totals.
  return Object.fromEntries(Object.entries(g.memberUsers).map(([member, user]) => [member, user ?? member]));
}

/**
 * Every outstanding debt visible to a user, expressed in user ids: each group's direct debts
 * plus friend-only expenses (entries already in user ids).
 *
 * Person-to-person balances are always direct (from the expenses two people actually share),
 * never simplified: simplification reroutes debts through third people (Paze pays you instead of
 * Avaneesh), which made a friend's page show a balance that didn't match your shared expenses.
 * "Simplify debts" only shapes a group's suggested payments (groupDebts). Each person's total
 * is the same either way.
 * With keepPlaceholders, debts with placeholder members are kept under their member id
 * (for totals); otherwise they're dropped (for friend lists).
 */
export function userDebts(
  groups: readonly GroupLedger[],
  direct: readonly LedgerEntry[],
  options: { keepPlaceholders?: boolean } = {},
): Debt[] {
  const fromGroups = groups.flatMap((g) =>
    remapDebts(pairwiseDebts(g.entries), userIdMap(g, options.keepPlaceholders ?? false)),
  );
  return sortDebts([...fromGroups, ...pairwiseDebts(direct)]);
}

export type PairBalance = {
  /** null = friend-only (outside any group). */
  groupId: string | null;
  currency: string;
  /** Positive: `other` owes `me`; negative: `me` owes `other`. */
  amount: Minor;
};

/** Where two people's direct balance lives: per group (and outside groups), per currency. Zero balances omitted. */
export function balancesBetween(
  groups: readonly KeyedGroupLedger[],
  direct: readonly LedgerEntry[],
  me: ParticipantId,
  other: ParticipantId,
): PairBalance[] {
  const out: PairBalance[] = [];
  const collect = (groupId: string | null, debts: Debt[]) => {
    for (const [currency, amount] of Object.entries(friendBalances(me, debts)[other] ?? {})) {
      out.push({ groupId, currency, amount });
    }
  };
  for (const g of groups) collect(g.groupId, remapDebts(pairwiseDebts(g.entries), g.memberUsers));
  collect(null, pairwiseDebts(direct));
  return out;
}

export type BalanceSummary = {
  /** What you owe, per currency (positive amounts). */
  owe: Record<string, Minor>;
  /** What you're owed, per currency. */
  owed: Record<string, Minor>;
  /** owed − owe, per currency (non-zero only). */
  net: Record<string, Minor>;
};

/** Totals across counterparties (from friendBalances), kept separate per currency. */
export function balanceSummary(byCounterparty: Readonly<Record<ParticipantId, Record<string, Minor>>>): BalanceSummary {
  const summary: BalanceSummary = { owe: {}, owed: {}, net: {} };
  for (const byCurrency of Object.values(byCounterparty)) {
    for (const [currency, amount] of Object.entries(byCurrency)) {
      if (amount > 0) summary.owed[currency] = (summary.owed[currency] ?? 0) + amount;
      if (amount < 0) summary.owe[currency] = (summary.owe[currency] ?? 0) - amount;
      summary.net[currency] = (summary.net[currency] ?? 0) + amount;
    }
  }
  for (const [currency, amount] of Object.entries(summary.net)) if (amount === 0) delete summary.net[currency];
  return summary;
}

/** One participant's balance per currency, from netBalances output. */
export function participantBalance(balances: CurrencyBalances, participantId: ParticipantId): Record<string, Minor> {
  const out: Record<string, Minor> = {};
  for (const [currency, byId] of Object.entries(balances)) if (byId[participantId]) out[currency] = byId[participantId];
  return out;
}
