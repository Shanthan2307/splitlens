import { allocate } from "./allocate";
import { SplitError } from "./errors";
import { assertMinor, normalizeZero, type Minor } from "./money";
import { expenseNet } from "./payers";
import type { Debt, ParticipantAmount, ParticipantId } from "./types";

export type LedgerExpense = {
  kind: "expense";
  currency: string;
  payers: ParticipantAmount[];
  shares: ParticipantAmount[];
};

/** `from` paid `to` `amount` to settle up. */
export type LedgerSettlement = {
  kind: "settlement";
  currency: string;
  from: ParticipantId;
  to: ParticipantId;
  amount: Minor;
};

export type LedgerEntry = LedgerExpense | LedgerSettlement;

/** currency → participant → net balance. Positive = is owed money; negative = owes. Zeros omitted. */
export type CurrencyBalances = Record<string, Record<ParticipantId, Minor>>;

function validateSettlement(s: LedgerSettlement) {
  assertMinor(s.amount, "settlement amount");
  if (s.amount <= 0) throw new SplitError("INVALID_AMOUNT", "Settlement amount must be positive");
  if (s.from === s.to) throw new SplitError("DUPLICATE_PARTICIPANT", "Cannot settle with yourself");
}

/** Per-participant net per currency (one group, or any set of entries). Each currency sums to zero. */
export function netBalances(entries: readonly LedgerEntry[]): CurrencyBalances {
  const result: CurrencyBalances = {};
  const add = (currency: string, id: ParticipantId, amount: Minor) => {
    const bucket = (result[currency] ??= {});
    bucket[id] = (bucket[id] ?? 0) + amount;
  };

  for (const entry of entries) {
    if (entry.kind === "expense") {
      for (const { participantId, amount } of expenseNet(entry.payers, entry.shares)) {
        add(entry.currency, participantId, amount);
      }
    } else {
      validateSettlement(entry);
      add(entry.currency, entry.from, entry.amount);
      add(entry.currency, entry.to, -entry.amount);
    }
  }

  return pruneZeros(result);
}

function pruneZeros(balances: CurrencyBalances): CurrencyBalances {
  const out: CurrencyBalances = {};
  for (const [currency, byId] of Object.entries(balances)) {
    const kept = Object.entries(byId).filter(([, v]) => v !== 0);
    if (kept.length > 0) out[currency] = Object.fromEntries(kept.map(([id, v]) => [id, normalizeZero(v)]));
  }
  return out;
}

/**
 * Who owes whom without simplification: each expense's debtors owe its creditors
 * in proportion to what the creditors are owed, then debts are netted per pair and currency.
 */
export function pairwiseDebts(entries: readonly LedgerEntry[]): Debt[] {
  const ledger = new PairLedger();
  for (const entry of entries) {
    if (entry.kind === "settlement") {
      validateSettlement(entry);
      // Paying someone reduces what you owe them.
      ledger.add(entry.currency, entry.to, entry.from, entry.amount);
      continue;
    }
    const net = expenseNet(entry.payers, entry.shares);
    // A refund flips roles: positive net is still "is owed", so the same logic applies.
    const creditors = net.filter((n) => n.amount > 0);
    const debtors = net.filter((n) => n.amount < 0);
    const remaining = creditors.map((c) => c.amount);
    for (const debtor of debtors) {
      // Weight by each creditor's remaining credit so both row and column totals stay exact.
      const parts = allocate(-debtor.amount, remaining);
      parts.forEach((part, i) => {
        if (part === 0) return;
        remaining[i] -= part;
        ledger.add(entry.currency, debtor.participantId, creditors[i].participantId, part);
      });
    }
  }
  return ledger.debts();
}

/** Accumulates signed debts per unordered pair and currency. */
class PairLedger {
  private readonly map = new Map<string, { currency: string; a: string; b: string; aOwesB: Minor }>();

  add(currency: string, from: ParticipantId, to: ParticipantId, amount: Minor) {
    const [a, b] = from < to ? [from, to] : [to, from];
    const key = JSON.stringify([currency, a, b]);
    const entry = this.map.get(key) ?? { currency, a, b, aOwesB: 0 };
    entry.aOwesB += from === a ? amount : -amount;
    this.map.set(key, entry);
  }

  debts(): Debt[] {
    const out: Debt[] = [];
    for (const { currency, a, b, aOwesB } of this.map.values()) {
      if (aOwesB > 0) out.push({ from: a, to: b, amount: aOwesB, currency });
      else if (aOwesB < 0) out.push({ from: b, to: a, amount: -aOwesB, currency });
    }
    return sortDebts(out);
  }
}

export function sortDebts(debts: Debt[]): Debt[] {
  return debts.sort(
    (x, y) =>
      x.currency.localeCompare(y.currency) || y.amount - x.amount || x.from.localeCompare(y.from) || x.to.localeCompare(y.to),
  );
}

/**
 * Maps participant ids (e.g. group member ids → user ids) on a list of debts.
 * Debts involving an unmapped participant (e.g. a placeholder with no account) are dropped.
 */
export function remapDebts(debts: readonly Debt[], idMap: Readonly<Record<ParticipantId, ParticipantId | null>>): Debt[] {
  const out: Debt[] = [];
  for (const d of debts) {
    const from = idMap[d.from];
    const to = idMap[d.to];
    if (from && to && from !== to) out.push({ ...d, from, to });
  }
  return out;
}

/**
 * One user's balance with each friend, per currency, across any number of groups
 * and friend-only expenses. Pass debts already expressed in user ids.
 * Positive = the friend owes `userId`; negative = `userId` owes the friend.
 */
export function friendBalances(
  userId: ParticipantId,
  debts: readonly Debt[],
): Record<ParticipantId, Record<string, Minor>> {
  const result: Record<ParticipantId, Record<string, Minor>> = {};
  for (const d of debts) {
    let friend: ParticipantId;
    let delta: Minor;
    if (d.to === userId) [friend, delta] = [d.from, d.amount];
    else if (d.from === userId) [friend, delta] = [d.to, -d.amount];
    else continue;
    const bucket = (result[friend] ??= {});
    bucket[d.currency] = (bucket[d.currency] ?? 0) + delta;
  }
  for (const [friend, byCurrency] of Object.entries(result)) {
    for (const [currency, amount] of Object.entries(byCurrency)) if (amount === 0) delete byCurrency[currency];
    if (Object.keys(byCurrency).length === 0) delete result[friend];
  }
  return result;
}

/** A user's overall balance per currency: what they're owed minus what they owe. */
export function totalBalance(userId: ParticipantId, debts: readonly Debt[]): Record<string, Minor> {
  const totals: Record<string, Minor> = {};
  for (const byCurrency of Object.values(friendBalances(userId, debts))) {
    for (const [currency, amount] of Object.entries(byCurrency)) totals[currency] = (totals[currency] ?? 0) + amount;
  }
  for (const [currency, amount] of Object.entries(totals)) if (amount === 0) delete totals[currency];
  return totals;
}
