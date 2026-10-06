import { SplitError } from "./errors";
import { assertMinor, type Minor } from "./money";
import { sortDebts, type CurrencyBalances } from "./balances";
import type { Debt, ParticipantId } from "./types";

/** Above this many non-zero balances (per currency) we use the greedy n−1 bound instead of the exact search. */
export const EXACT_SIMPLIFY_LIMIT = 16;

/**
 * Minimizes the number of transfers that settle every balance, per currency.
 *
 * The minimum is (people with non-zero balance) − (max number of disjoint zero-sum
 * subgroups), since each subgroup of k settles internally in k−1 transfers.
 * Finding that partition is NP-hard, so it is solved exactly with a subset DP for up to
 * EXACT_SIMPLIFY_LIMIT people and greedily (largest debtor ↔ largest creditor, at most n−1
 * transfers) beyond that. Results are deterministic.
 */
export function simplifyDebts(balances: CurrencyBalances): Debt[] {
  const debts: Debt[] = [];
  for (const [currency, byId] of Object.entries(balances)) {
    const people = Object.entries(byId)
      .filter(([, amount]) => amount !== 0)
      .map(([id, amount]) => {
        assertMinor(amount, `balance for ${id}`);
        return { id, amount };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    const sum = people.reduce((acc, p) => acc + p.amount, 0);
    if (sum !== 0) throw new SplitError("SUM_MISMATCH", `${currency} balances sum to ${sum}, not zero`);

    const groups = people.length <= EXACT_SIMPLIFY_LIMIT ? zeroSumPartition(people) : [people];
    for (const group of groups) {
      for (const t of settleGreedily(group)) debts.push({ ...t, currency });
    }
  }
  return sortDebts(debts);
}

type Person = { id: ParticipantId; amount: Minor };

/**
 * Splits people into the maximum number of disjoint zero-sum groups.
 * dp[mask] = max number of zero prefix sums over orderings of `mask`; an ordering that
 * achieves it is rebuilt backwards and cut at each zero prefix sum.
 */
function zeroSumPartition(people: Person[]): Person[][] {
  const n = people.length;
  if (n === 0) return [];
  const size = 1 << n;
  const sums = new Float64Array(size);
  const dp = new Int8Array(size);

  for (let mask = 1; mask < size; mask++) {
    const low = mask & -mask;
    const i = 31 - Math.clz32(low);
    sums[mask] = sums[mask ^ low] + people[i].amount;
    let best = 0;
    for (let rest = mask; rest; rest &= rest - 1) {
      const bit = rest & -rest;
      if (dp[mask ^ bit] > best) best = dp[mask ^ bit];
    }
    dp[mask] = best + (sums[mask] === 0 ? 1 : 0);
  }

  // Rebuild an optimal ordering by peeling off the last element at each step.
  const ordering: number[] = [];
  let mask = size - 1;
  while (mask) {
    const target = dp[mask] - (sums[mask] === 0 ? 1 : 0);
    for (let rest = mask; rest; rest &= rest - 1) {
      const bit = rest & -rest;
      if (dp[mask ^ bit] === target) {
        ordering.push(31 - Math.clz32(bit));
        mask ^= bit;
        break;
      }
    }
  }
  ordering.reverse();

  const groups: Person[][] = [];
  let current: Person[] = [];
  let running = 0;
  for (const i of ordering) {
    current.push(people[i]);
    running += people[i].amount;
    if (running === 0) {
      groups.push(current);
      current = [];
    }
  }
  return groups;
}

/** Settles a zero-sum group in at most (size − 1) transfers: largest debtor pays largest creditor. */
function settleGreedily(group: Person[]): Omit<Debt, "currency">[] {
  const byAmountThenId = (a: Person, b: Person) => b.amount - a.amount || a.id.localeCompare(b.id);
  const creditors = group.filter((p) => p.amount > 0).map((p) => ({ ...p }));
  const debtors = group.filter((p) => p.amount < 0).map((p) => ({ id: p.id, amount: -p.amount }));
  const transfers: Omit<Debt, "currency">[] = [];

  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(byAmountThenId);
    debtors.sort(byAmountThenId);
    const c = creditors[0];
    const d = debtors[0];
    const amount = Math.min(c.amount, d.amount);
    transfers.push({ from: d.id, to: c.id, amount });
    c.amount -= amount;
    d.amount -= amount;
    if (c.amount === 0) creditors.shift();
    if (d.amount === 0) debtors.shift();
  }
  return transfers;
}
